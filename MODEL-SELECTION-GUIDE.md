# Model Selection Guide

## Overview

The OpenClaw agent now supports easy model selection from a comprehensive list of available models across multiple providers (OpenAI, Anthropic, Google, OpenRouter, etc.).

## Features

### 1. **Fetch Available Models**

Use the `/api/models` endpoint (authenticated with Bearer token) or `/setup/api/models` endpoint (setup wizard) to get the full list of available models:

```bash
# Via API (requires WRAPPER_API_KEY)
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:8080/api/models

# Via Setup Wizard (requires setup authentication)
curl --cookie "setup_session=..." \
  http://localhost:8080/setup/api/models
```

**Response:**
```json
{
  "ok": true,
  "models": [
    {
      "provider": "openai",
      "name": "gpt-4",
      "fullName": "openai/gpt-4",
      "details": "8k context",
      "raw": "openai/gpt-4 (8k context)"
    },
    {
      "provider": "openai",
      "name": "gpt-4-turbo",
      "fullName": "openai/gpt-4-turbo",
      "details": "128k context",
      "raw": "openai/gpt-4-turbo (128k context)"
    },
    {
      "provider": "anthropic",
      "name": "claude-3-opus",
      "fullName": "anthropic/claude-3-opus",
      "details": "200k context",
      "raw": "anthropic/claude-3-opus (200k context)"
    }
  ],
  "exitCode": 0
}
```

### 2. **Setup Wizard UI**

The setup wizard now includes two ways to specify a model:

#### **Option A: Choose from List**
1. Click the "Choose from list" button
2. Select from a dropdown grouped by provider (OpenAI, Anthropic, Google, etc.)
3. Models are displayed with their context window and capabilities

#### **Option B: Custom Input**
1. Click the "Custom" button
2. Type the model name manually (e.g., `gpt-4o-mini`, `claude-sonnet-4`)
3. Useful for newly released models not yet in the cached list

### 3. **Headless API Configuration**

When configuring via the API, you can now specify any model from the list:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "authChoice": "openai-api-key",
    "authSecret": "sk-...",
    "model": "openai/gpt-4-turbo"
  }' \
  http://localhost:8080/api/configure
```

**Supported providers:**
- `openai/...` - OpenAI models (GPT-4, GPT-4-turbo, GPT-3.5, etc.)
- `anthropic/...` - Anthropic Claude models (Opus, Sonnet, Haiku)
- `google/...` - Google Gemini models
- `openrouter/...` - OpenRouter models (100+ models)

## Model Format

Models can be specified in two formats:

### Fully-Qualified (Recommended)
```
provider/model-name
```
Examples:
- `openai/gpt-4-turbo`
- `anthropic/claude-3-opus`
- `google/gemini-pro`
- `openrouter/anthropic/claude-3-opus`

### Short Format (Auto-Prefixed)
```
model-name
```
The system will auto-prefix with the selected provider.

⚠️ **Important:** Always use fully-qualified names to avoid ambiguity.

## Why Only "codex" Was Working?

If you found that only "codex openai" was working, it's likely because:

1. **Incorrect model format** - You may have been using short names without the provider prefix
2. **Model not in catalog** - The model name wasn't recognized by OpenClaw
3. **API key mismatch** - The API key didn't have access to the specified model

### Solution:
1. Use the `/api/models` endpoint to see ALL available models
2. Pick from the dropdown in the setup wizard
3. Always use the full `provider/model-name` format
4. Verify your API key has access to the model you selected

## Examples

### Example 1: List All Models
```bash
curl -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  http://localhost:8080/api/models | jq '.models[] | "\(.provider)/\(.name) - \(.details)"'
```

### Example 2: Configure with GPT-4 Turbo
```bash
curl -X POST \
  -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  -H "Content-Type: application/json" \
  -d '{
    "authChoice": "openai-api-key",
    "authSecret": "sk-proj-...",
    "model": "openai/gpt-4-turbo",
    "telegramToken": "YOUR_BOT_TOKEN"
  }' \
  http://localhost:8080/api/configure
```

### Example 3: Configure with Claude Opus
```bash
curl -X POST \
  -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  -H "Content-Type: application/json" \
  -d '{
    "authChoice": "apiKey",
    "authSecret": "sk-ant-...",
    "model": "anthropic/claude-3-opus",
    "telegramToken": "YOUR_BOT_TOKEN"
  }' \
  http://localhost:8080/api/configure
```

### Example 4: Use OpenRouter for Access to Many Models
```bash
curl -X POST \
  -H "Authorization: Bearer f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659" \
  -H "Content-Type: application/json" \
  -d '{
    "authChoice": "openrouter-api-key",
    "authSecret": "sk-or-...",
    "model": "openrouter/anthropic/claude-3-opus",
    "telegramToken": "YOUR_BOT_TOKEN"
  }' \
  http://localhost:8080/api/configure
```

## Frontend Integration

### React/Vue/Angular Example
```typescript
interface Model {
  provider: string;
  name: string;
  fullName: string;
  details?: string;
  raw: string;
}

async function fetchAvailableModels(apiKey: string): Promise<Model[]> {
  const response = await fetch('http://localhost:8080/api/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });
  
  const data = await response.json();
  return data.models || [];
}

// Group by provider for UI
function groupModelsByProvider(models: Model[]) {
  return models.reduce((acc, model) => {
    const provider = model.provider || 'Other';
    if (!acc[provider]) {
      acc[provider] = [];
    }
    acc[provider].push(model);
    return acc;
  }, {} as Record<string, Model[]>);
}

// Use in dropdown
const models = await fetchAvailableModels(API_KEY);
const grouped = groupModelsByProvider(models);

// Render
Object.entries(grouped).map(([provider, models]) => (
  <optgroup label={provider.toUpperCase()}>
    {models.map(m => (
      <option value={m.fullName}>
        {m.name} {m.details && `(${m.details})`}
      </option>
    ))}
  </optgroup>
));
```

## Troubleshooting

### Problem: "Model not found" error
**Solution:** Use `/api/models` to verify the model exists in OpenClaw's catalog.

### Problem: Models list is empty
**Solution:** Ensure OpenClaw CLI is installed and accessible. Check logs for errors.

### Problem: Can't access certain models
**Solution:** Verify your API key has access to those models. Some models require paid API plans.

### Problem: Dropdown shows old models
**Solution:** Models are fetched from OpenClaw CLI each time. Update OpenClaw to get the latest model list:
```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

## See Also

- [API Documentation](API.md)
- [Configuration Guide](README.md)
- [Troubleshooting](TROUBLESHOOTING-PAIRING.md)
