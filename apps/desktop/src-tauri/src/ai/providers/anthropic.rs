use async_trait::async_trait;
use futures_util::StreamExt;
use tauri::{Emitter, WebviewWindow};

use super::super::{
    AiCompleteEvent, AiMessage, AiOutputEvent, AiProvider, AiProviderInfo, AiRequest, AiSessionInfo,
};

pub struct AnthropicProvider;

#[async_trait]
impl AiProvider for AnthropicProvider {
    fn id(&self) -> &str {
        "anthropic"
    }

    fn name(&self) -> &str {
        "Anthropic API"
    }

    async fn check_status(&self) -> AiProviderInfo {
        let has_key = std::env::var("ANTHROPIC_API_KEY")
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        AiProviderInfo {
            id: "anthropic".to_string(),
            name: "Anthropic API".to_string(),
            ready: has_key,
            message: if has_key {
                Some("ANTHROPIC_API_KEY is set".to_string())
            } else {
                Some("Set ANTHROPIC_API_KEY to enable".to_string())
            },
        }
    }

    async fn execute(&self, window: WebviewWindow, request: AiRequest) -> Result<(), String> {
        let provider_id = self.id().to_string();
        let tab_id = request.tab_id.clone();
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .filter(|v| !v.is_empty())
            .ok_or_else(|| "ANTHROPIC_API_KEY not set".to_string())?;

        let model = request
            .model
            .unwrap_or_else(|| "claude-sonnet-5".to_string());

        let mut messages: Vec<serde_json::Value> = request
            .messages
            .iter()
            .filter_map(|m| anthropic_message_to_json(m))
            .collect();
        // Empty prompt = tool-loop continuation; the tool results are already
        // the trailing user message in `messages`
        if !request.prompt.is_empty() {
            messages.push(serde_json::json!({
                "role": "user",
                "content": request.prompt
            }));
        }

        let mut body = serde_json::json!({
            "model": model,
            "max_tokens": 16000,
            "messages": messages,
            "stream": true,
            "system": super::resolve_system_prompt(request.system_prompt, request.skill_prompt),
        });

        if let Some(tools) = &request.tools {
            if !tools.is_empty() {
                body["tools"] = serde_json::json!(tools
                    .iter()
                    .map(|t| serde_json::json!({
                        "name": t.name,
                        "description": t.description,
                        "input_schema": t.input_schema,
                    }))
                    .collect::<Vec<_>>());
            }
        }

        let client = reqwest::Client::new();
        let response = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("API request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error {}: {}", status, text));
        }

        let provider_clone = provider_id.clone();
        let win = window.clone();
        let tid = tab_id.clone();

        tokio::spawn(async move {
            let mut stream = response.bytes_stream();
            let mut buf = String::new();
            let mut success = true;

            while let Some(chunk) = stream.next().await {
                let chunk = match chunk {
                    Ok(c) => c,
                    Err(_) => {
                        success = false;
                        break;
                    }
                };
                buf.push_str(&String::from_utf8_lossy(&chunk));

                // Emit each complete SSE data line as it arrives
                while let Some(pos) = buf.find('\n') {
                    let line = buf[..pos].trim().to_string();
                    buf.drain(..=pos);
                    if line.is_empty() || !line.starts_with("data: ") {
                        continue;
                    }
                    let data = &line[6..];
                    if data == "[DONE]" {
                        continue;
                    }
                    let _ = win.emit(
                        "ai-output",
                        AiOutputEvent {
                            tab_id: tid.clone(),
                            data: data.to_string(),
                            provider: provider_clone.clone(),
                        },
                    );
                }
            }

            let _ = win.emit(
                "ai-complete",
                AiCompleteEvent {
                    tab_id: tid.clone(),
                    success,
                    provider: provider_clone,
                },
            );
        });

        Ok(())
    }

    async fn cancel(&self, _window: &WebviewWindow, _tab_id: &str) -> Result<(), String> {
        Ok(())
    }

    async fn list_models(&self) -> Result<Vec<String>, String> {
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .filter(|v| !v.is_empty())
            .ok_or_else(|| "ANTHROPIC_API_KEY not set".to_string())?;

        let client = reqwest::Client::new();
        let response = client
            .get("https://api.anthropic.com/v1/models?limit=100")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error {}: {}", status, text));
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let ids = json["data"]
            .as_array()
            .map(|models| {
                models
                    .iter()
                    .filter_map(|m| m["id"].as_str().map(String::from))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        Ok(ids)
    }

    async fn list_sessions(&self, _project_path: &str) -> Result<Vec<AiSessionInfo>, String> {
        Ok(Vec::new())
    }

    async fn load_session(
        &self,
        _project_path: &str,
        _session_id: &str,
    ) -> Result<Vec<AiMessage>, String> {
        Err("Session loading not supported for API providers".to_string())
    }
}

fn anthropic_message_to_json(msg: &AiMessage) -> Option<serde_json::Value> {
    let role = match msg.role.as_str() {
        "user" | "assistant" => msg.role.as_str(),
        _ => return None,
    };

    let content = msg.content.as_ref()?;
    let mut blocks: Vec<serde_json::Value> = Vec::new();

    for block in content {
        match block {
            super::super::AiContentBlock::Text { text } => {
                blocks.push(serde_json::json!({"type": "text", "text": text}));
            }
            super::super::AiContentBlock::ToolUse { id, name, input } => {
                blocks.push(serde_json::json!({
                    "type": "tool_use",
                    "id": id,
                    "name": name,
                    "input": input
                }));
            }
            super::super::AiContentBlock::ToolResult {
                tool_use_id,
                content,
                is_error,
            } => {
                blocks.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": content,
                    "is_error": is_error.unwrap_or(false)
                }));
            }
            _ => {}
        }
    }

    if blocks.is_empty() {
        return None;
    }

    Some(serde_json::json!({
        "role": role,
        "content": blocks
    }))
}
