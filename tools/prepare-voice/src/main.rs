use std::{env, error::Error, fs, path::Path};

use omnivoice_infer::{
    audio_input::load_audio_file,
    contracts::{ReferenceAudioInput, WaveformInput},
    pipeline::Phase3Pipeline,
    DTypeSpec, DeviceSpec, RuntimeOptions,
};
use serde_json::json;
use sha2::{Digest, Sha256};

const PROFILE_ID: &str = "c90953352421463ebc9da45d8a916c47";
const REFERENCE_HASH: &str = "7f42fc8c38fd7d1115f40f62b03c7b6897a44ed15bc661fa1e23ae5c5094001c";
const TRANSCRIPT: &str = include_str!("../reference-transcript.txt");

fn main() -> Result<(), Box<dyn Error>> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 3 && args.len() != 4 {
        return Err(
            "usage: prepare-fixed-voice MODEL_ROOT REFERENCE_WAV OUTPUT_JSON [4s|9s]".into(),
        );
    }
    let reference_bytes = fs::read(&args[1])?;
    let reference_hash = format!("{:x}", Sha256::digest(&reference_bytes));
    if reference_hash != REFERENCE_HASH {
        return Err("reference SHA-256 does not match the fixed GS Deutsche Bahn profile".into());
    }
    let waveform = load_audio_file(&args[1])?;
    if waveform.sample_rate != 24_000 || waveform.channels != 1 || waveform.samples.len() != 919_200
    {
        return Err("expected the complete 38.3 second, 24 kHz mono reference".into());
    }
    let candidates: serde_json::Value =
        serde_json::from_str(include_str!("../reduced-candidates.json"))?;
    let candidate = args
        .get(3)
        .map(|id| {
            candidates
                .get(id)
                .ok_or("unknown reduced conditioning candidate")
        })
        .transpose()?;
    let (reference_input, transcript, expected_frames, candidate_provenance) = if let Some(
        candidate,
    ) = candidate
    {
        let start = candidate["startSeconds"]
            .as_f64()
            .ok_or("missing crop start")?;
        let end = candidate["endSeconds"].as_f64().ok_or("missing crop end")?;
        if !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start || end > 38.3 {
            return Err("invalid reference crop bounds".into());
        }
        let start_sample = (start * 24000.0).round() as usize;
        let end_sample = (end * 24000.0).round() as usize;
        let samples = waveform.samples[start_sample..end_sample].to_vec();
        let pcm_bytes = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect::<Vec<_>>();
        let provenance = json!({
            "sourceReferenceSha256":REFERENCE_HASH, "sourceReferenceSeconds":38.3,
            "startSeconds":start, "endSeconds":end, "sampleCount":samples.len(),
            "pcmSha256":format!("{:x}",Sha256::digest(&pcm_bytes)),
            "pcmFormat":"IEEE754-f32 little endian, mono, 24000 Hz; decoded saved-reference samples before RMS normalization",
            "originalCue":candidate["originalCue"],
            "qualification":"NOT RUN: voice identity, intelligibility and efficiency parity require comparison with the full reference"
        });
        (
            ReferenceAudioInput::Waveform(WaveformInput::mono(samples, 24000)),
            candidate["refText"]
                .as_str()
                .ok_or("missing reduced transcript")?,
            (end_sample - start_sample) / 960,
            Some(provenance),
        )
    } else {
        (
            ReferenceAudioInput::from_path(&args[1]),
            TRANSCRIPT.trim(),
            957,
            None,
        )
    };
    eprintln!("Encoding {expected_frames} explicitly selected reference frames with CPU FP32; no VAD or ASR");
    let pipeline = Phase3Pipeline::from_options(
        RuntimeOptions::new(&args[0])
            .with_device(DeviceSpec::Cpu)
            .with_dtype(DTypeSpec::F32),
    )?;
    let prompt = pipeline.create_voice_clone_prompt_from_audio(
        &reference_input,
        Some(transcript),
        false,
        None,
    )?;
    let (codebooks, frames) = prompt.ref_audio_tokens.dims();
    if codebooks != 8
        || frames != expected_frames
        || prompt.ref_audio_tokens.data.len() != 8 * expected_frames
    {
        return Err(format!("unexpected conditioning token shape: ({codebooks}, {frames})").into());
    }
    if prompt
        .ref_audio_tokens
        .data
        .iter()
        .any(|id| !(0..=1023).contains(id))
    {
        return Err("conditioning includes an out-of-range codec token".into());
    }
    let ref_rms = prompt.ref_rms.ok_or("reference RMS is absent")?;
    if !ref_rms.is_finite() || ref_rms <= 0.0 || prompt.ref_text != transcript {
        return Err("invalid reference RMS or altered transcript".into());
    }
    let rows = prompt
        .ref_audio_tokens
        .data
        .chunks_exact(frames)
        .collect::<Vec<_>>();
    let mut asset = json!({
        "name": "GS Deutsche Bahn Durchsage",
        "profileId": PROFILE_ID,
        "referenceSha256": reference_hash,
        "referenceSeconds": 38.3,
        "refText": prompt.ref_text,
        "refRms": ref_rms,
        "refAudioTokens": rows,
        "sampleRate": 24000,
        "conditioningFrames": frames,
        "conditioningSeconds": frames as f64 * 0.04,
        "preprocessPrompt": false,
        "nativeLibraryRevision": "4c7b088294fd6f3a5fb9e3b1dfd3a77bc12f105b"
    });
    if let Some(provenance) = candidate_provenance {
        asset["conditioningCandidate"] = json!(args[3]);
        asset["conditioningSource"] = provenance;
    }
    let output = Path::new(&args[2]);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, serde_json::to_vec(&asset)?)?;
    if format!("{:x}", Sha256::digest(fs::read(&args[1])?)) != REFERENCE_HASH {
        return Err("source reference changed during preparation".into());
    }
    println!(
        "wrote {} with 8 x {frames} token IDs and RMS {ref_rms}",
        output.display()
    );
    Ok(())
}
