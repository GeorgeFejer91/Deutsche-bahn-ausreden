use std::{env, error::Error, fs, path::Path};

use omnivoice_infer::{
    artifacts::ReferenceArtifactBundle,
    contracts::{GeneratedTokens, GenerationRequest, I64Tensor2, VoiceClonePrompt},
    frontend::Frontend,
    stage1_decoder::Stage1RuntimePlan,
    DTypeSpec, DeviceSpec, RuntimeOptions,
};
use safetensors::tensor::{serialize_to_file, Dtype, TensorView};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn fixed_prompt(path: &str) -> Result<VoiceClonePrompt, Box<dyn Error>> {
    let bytes = fs::read(path)?;
    let voice: Value = serde_json::from_slice(&bytes)?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let frames = match hash.as_str() {
        "b0a4320cf6680f67255db11e948a5da8e6127fc3d95d8b1d757ce0314997aaa9" => 957,
        "06a12ae8736b2342d08cb3a9512d0dcb3d2d2a3cefe5bba52383cf078d650301" => 100,
        "98869125c75bf133fa56a96ef6cedcf10cbd2096b8985084374888762f553d15" => 225,
        _ => return Err("conditioning does not match a prepared fixed-voice asset".into()),
    };
    if voice["profileId"] != "c90953352421463ebc9da45d8a916c47"
        || voice["referenceSha256"]
            != "7f42fc8c38fd7d1115f40f62b03c7b6897a44ed15bc661fa1e23ae5c5094001c"
        || voice["sampleRate"] != 24000
    {
        return Err("wrong fixed voice conditioning".into());
    }
    let rows: Vec<Vec<i64>> = serde_json::from_value(voice["refAudioTokens"].clone())?;
    if rows.len() != 8
        || rows
            .iter()
            .any(|row| row.len() != frames || row.iter().any(|id| !(0..=1023).contains(id)))
    {
        return Err("invalid fixed conditioning tokens".into());
    }
    let rms = voice["refRms"].as_f64().ok_or("missing reference RMS")? as f32;
    if !rms.is_finite() || rms <= 0.0 {
        return Err("invalid reference RMS".into());
    }
    Ok(VoiceClonePrompt {
        ref_audio_tokens: I64Tensor2::new((8, frames), rows.into_iter().flatten().collect())?,
        ref_text: voice["refText"]
            .as_str()
            .ok_or("missing fixed transcript")?
            .to_owned(),
        ref_rms: Some(rms),
    })
}

fn main() -> Result<(), Box<dyn Error>> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 4 {
        return Err("usage: cached-clips prepare MODEL VOICE_JSON FIXTURE_DIR | decode MODEL VOICE_JSON TOKENS_JSON WAV".into());
    }
    let voice = fixed_prompt(&args[2])?;
    let reference_frames = voice.ref_audio_tokens.dims().1;
    match args[0].as_str() {
        "prepare" if args.len() == 4 => {
            let root = Path::new(&args[3]);
            fs::create_dir_all(root)?;
            let frontend = Frontend::from_model_root(&args[1])?;
            let clips: Vec<Value> = serde_json::from_str(include_str!("../../clips.json"))?;
            for clip in clips {
                let id = clip["id"].as_str().ok_or("missing clip ID")?;
                if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                    return Err("invalid clip ID".into());
                }
                let text = clip["text"].as_str().ok_or("missing clip text")?;
                let mut request = GenerationRequest::new_text_only(text);
                request.languages = vec![Some("de".to_owned())];
                request.voice_clone_prompts = vec![Some(voice.clone())];
                request.generation_config.preprocess_prompt = false;
                let task = frontend.build_task(&request)?;
                let prompt = frontend.prepare_prompt(&task, 0)?;
                let case_dir = root.join(id);
                fs::create_dir_all(&case_dir)?;
                let ids = prompt
                    .prompt
                    .input_ids
                    .data
                    .iter()
                    .flat_map(|id| id.to_le_bytes())
                    .collect::<Vec<_>>();
                let mask = prompt
                    .prompt
                    .audio_mask
                    .data
                    .iter()
                    .map(|x| u8::from(*x))
                    .collect::<Vec<_>>();
                let shape = prompt.prompt.input_ids.dims();
                let mask_shape = prompt.prompt.audio_mask.dims();
                serialize_to_file(
                    [
                        (
                            "prepared_input_ids",
                            TensorView::new(Dtype::I64, vec![shape.0, shape.1, shape.2], &ids)?,
                        ),
                        (
                            "audio_mask",
                            TensorView::new(Dtype::BOOL, vec![mask_shape.0, mask_shape.1], &mask)?,
                        ),
                    ],
                    None,
                    &case_dir.join("inputs.safetensors"),
                )?;
                let metadata = json!({
                    "mode":"clone", "style_text":prompt.style_text, "full_text":prompt.full_text,
                    "style_token_ids":prompt.style_token_ids, "text_token_ids":prompt.text_token_ids,
                    "target_start_idx":prompt.target_start_idx, "total_length":prompt.total_length,
                    "segments": { "style_length":prompt.style_token_ids.len(), "text_length":prompt.text_token_ids.len(), "ref_audio_length":reference_frames, "target_length":prompt.target_length },
                    "texts":[text], "langs":["de"], "ref_texts":[voice.ref_text], "ref_rms":[voice.ref_rms],
                    "generation_config":{"denoise":true,"postprocess_output":true}
                });
                fs::write(
                    case_dir.join("prepared.json"),
                    serde_json::to_vec(&metadata)?,
                )?;
                fs::write(
                    case_dir.join("case.json"),
                    serde_json::to_vec(
                        &json!({"text":text,"language":"de","ref_audio":"cached-fixed-conditioning","ref_text":voice.ref_text,"generation":{"preprocess_prompt":false}}),
                    )?,
                )?;
                // Exercise the actual native artifact reader before expensive inference.
                let loaded = ReferenceArtifactBundle::from_root(root)?
                    .case_by_id(id)?
                    .load_prepared_prompt()?;
                if loaded != prompt {
                    return Err("native prepared-prompt round trip failed".into());
                }
                println!(
                    "prepared {id}: {} fixed-reference frames, {} target frames",
                    reference_frames, prompt.target_length
                );
            }
        }
        "decode" if args.len() == 5 => {
            let generated: Value = serde_json::from_slice(&fs::read(&args[3])?)?;
            let dims: Vec<usize> = serde_json::from_value(generated["dims"].clone())?;
            let data: Vec<i64> = serde_json::from_value(generated["tokens"].clone())?;
            if generated["kind"] != "single"
                || dims.len() != 2
                || dims[0] != 8
                || dims[1] == 0
                || dims[1] > 1000
                || data.iter().any(|id| !(0..=1023).contains(id))
            {
                return Err("invalid generated native codec tokens".into());
            }
            let tokens = GeneratedTokens::Single(I64Tensor2::new((dims[0], dims[1]), data)?);
            let decoder = Stage1RuntimePlan::from_options(
                RuntimeOptions::new(&args[1])
                    .with_device(DeviceSpec::Cpu)
                    .with_dtype(DTypeSpec::F32),
            )?;
            let audio = decoder.decode_final(&tokens, voice.ref_rms, true)?;
            audio.write_wav(&args[4])?;
            println!(
                "decoded native tokens to {}: {} samples at {} Hz",
                args[4],
                audio.samples.len(),
                audio.sample_rate
            );
        }
        _ => return Err("invalid cached-clips invocation".into()),
    }
    Ok(())
}
