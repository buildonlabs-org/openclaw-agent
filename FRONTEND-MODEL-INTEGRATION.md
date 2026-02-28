# Frontend Model Integration Guide

## Overview

The API now returns **600+ models** from multiple providers. This guide shows how to integrate model selection into your frontend.

## API Response

The `/api/models` endpoint returns:

```json
{
  "ok": true,
  "models": [
    {
      "provider": "openai",
      "name": "gpt-5.1-codex",
      "fullName": "openai/gpt-5.1-codex",
      "details": "text+image 391k",
      "raw": "openai/gpt-5.1-codex..."
    }
  ],
  "exitCode": 0
}
```

## Quick Start

### Basic Fetch

```javascript
async function fetchModels(apiKey) {
  const response = await fetch('http://localhost:8080/api/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });
  const data = await response.json();
  return data.models.filter(m => m.provider); // Skip header rows
}
```

### Filter by Provider

```javascript
async function fetchModelsByProvider(apiKey, provider) {
  const response = await fetch(
    `http://localhost:8080/api/models?provider=${provider}`,
    {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    }
  );
  const data = await response.json();
  return data.models.filter(m => m.provider);
}
```

## Group by Provider

```javascript
function groupByProvider(models) {
  return models.reduce((acc, model) => {
    const provider = model.provider || 'other';
    if (!acc[provider]) {
      acc[provider] = [];
    }
    acc[provider].push(model);
    return acc;
  }, {});
}
```

## React Component Example

```jsx
import React, { useState, useEffect, useMemo } from 'react';

function ModelSelector({ apiKey, onModelSelect, selectedModel }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('all');

  useEffect(() => {
    async function loadModels() {
      setLoading(true);
      try {
        const response = await fetch('http://localhost:8080/api/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const data = await response.json();
        setModels(data.models.filter(m => m.provider));
      } catch (error) {
        console.error('Failed to load models:', error);
      } finally {
        setLoading(false);
      }
    }
    loadModels();
  }, [apiKey]);

  // Get unique providers
  const providers = useMemo(() => {
    const uniqueProviders = [...new Set(models.map(m => m.provider))];
    return uniqueProviders.sort();
  }, [models]);

  // Filter models
  const filteredModels = useMemo(() => {
    return models.filter(model => {
      const matchesSearch = 
        !searchTerm || 
        model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        model.fullName.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesProvider = 
        selectedProvider === 'all' || 
        model.provider === selectedProvider;
      
      return matchesSearch && matchesProvider;
    });
  }, [models, searchTerm, selectedProvider]);

  // Group filtered models by provider
  const groupedModels = useMemo(() => {
    return filteredModels.reduce((acc, model) => {
      const provider = model.provider || 'other';
      if (!acc[provider]) {
        acc[provider] = [];
      }
      acc[provider].push(model);
      return acc;
    }, {});
  }, [filteredModels]);

  if (loading) {
    return <div>Loading models...</div>;
  }

  return (
    <div className="model-selector">
      {/* Search and Filter */}
      <div className="controls">
        <input
          type="text"
          placeholder="Search models..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
        
        <select
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value)}
          className="provider-filter"
        >
          <option value="all">All Providers ({models.length})</option>
          {providers.map(provider => (
            <option key={provider} value={provider}>
              {provider.toUpperCase()} ({models.filter(m => m.provider === provider).length})
            </option>
          ))}
        </select>
      </div>

      {/* Model List */}
      <div className="model-list">
        {Object.entries(groupedModels).map(([provider, providerModels]) => (
          <div key={provider} className="provider-group">
            <h3>{provider.toUpperCase()}</h3>
            <div className="models">
              {providerModels.map(model => (
                <button
                  key={model.fullName}
                  onClick={() => onModelSelect(model.fullName)}
                  className={`model-item ${selectedModel === model.fullName ? 'selected' : ''}`}
                >
                  <span className="model-name">{model.name}</span>
                  {model.details && (
                    <span className="model-details">{model.details}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {filteredModels.length === 0 && (
        <div className="no-results">
          No models found matching "{searchTerm}"
        </div>
      )}
    </div>
  );
}

export default ModelSelector;
```

## Vue 3 Component Example

```vue
<template>
  <div class="model-selector">
    <!-- Search and Filter -->
    <div class="controls">
      <input
        v-model="searchTerm"
        type="text"
        placeholder="Search models..."
        class="search-input"
      />
      
      <select v-model="selectedProvider" class="provider-filter">
        <option value="all">All Providers ({{ models.length }})</option>
        <option v-for="provider in providers" :key="provider" :value="provider">
          {{ provider.toUpperCase() }} ({{ getProviderCount(provider) }})
        </option>
      </select>
    </div>

    <!-- Loading State -->
    <div v-if="loading">Loading models...</div>

    <!-- Model List -->
    <div v-else class="model-list">
      <div v-for="[provider, providerModels] in Object.entries(groupedModels)" 
           :key="provider" 
           class="provider-group">
        <h3>{{ provider.toUpperCase() }}</h3>
        <div class="models">
          <button
            v-for="model in providerModels"
            :key="model.fullName"
            @click="$emit('select', model.fullName)"
            :class="['model-item', { selected: modelValue === model.fullName }]"
          >
            <span class="model-name">{{ model.name }}</span>
            <span v-if="model.details" class="model-details">{{ model.details }}</span>
          </button>
        </div>
      </div>

      <div v-if="filteredModels.length === 0" class="no-results">
        No models found matching "{{ searchTerm }}"
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const props = defineProps({
  apiKey: String,
  modelValue: String
});

const emit = defineEmits(['select']);

const models = ref([]);
const loading = ref(false);
const searchTerm = ref('');
const selectedProvider = ref('all');

// Unique providers
const providers = computed(() => {
  const unique = [...new Set(models.value.map(m => m.provider))];
  return unique.sort();
});

// Filtered models
const filteredModels = computed(() => {
  return models.value.filter(model => {
    const matchesSearch = 
      !searchTerm.value || 
      model.name.toLowerCase().includes(searchTerm.value.toLowerCase()) ||
      model.fullName.toLowerCase().includes(searchTerm.value.toLowerCase());
    
    const matchesProvider = 
      selectedProvider.value === 'all' || 
      model.provider === selectedProvider.value;
    
    return matchesSearch && matchesProvider;
  });
});

// Grouped models
const groupedModels = computed(() => {
  return filteredModels.value.reduce((acc, model) => {
    const provider = model.provider || 'other';
    if (!acc[provider]) {
      acc[provider] = [];
    }
    acc[provider].push(model);
    return acc;
  }, {});
});

function getProviderCount(provider) {
  return models.value.filter(m => m.provider === provider).length;
}

async function loadModels() {
  loading.value = true;
  try {
    const response = await fetch('http://localhost:8080/api/models', {
      headers: { 'Authorization': `Bearer ${props.apiKey}` }
    });
    const data = await response.json();
    models.value = data.models.filter(m => m.provider);
  } catch (error) {
    console.error('Failed to load models:', error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadModels();
});
</script>
```

## Vanilla JavaScript (Alpine.js style)

```html
<div x-data="modelSelector()" x-init="loadModels()">
  <!-- Search and Filter -->
  <div class="controls">
    <input
      x-model="searchTerm"
      type="text"
      placeholder="Search models..."
      class="search-input"
    />
    
    <select x-model="selectedProvider" class="provider-filter">
      <option value="all">All Providers (<span x-text="models.length"></span>)</option>
      <template x-for="provider in providers" :key="provider">
        <option :value="provider" x-text="`${provider.toUpperCase()} (${getProviderCount(provider)})`"></option>
      </template>
    </select>
  </div>

  <!-- Loading -->
  <div x-show="loading">Loading models...</div>

  <!-- Model List -->
  <div x-show="!loading" class="model-list">
    <template x-for="[provider, providerModels] in Object.entries(groupedModels)" :key="provider">
      <div class="provider-group">
        <h3 x-text="provider.toUpperCase()"></h3>
        <div class="models">
          <template x-for="model in providerModels" :key="model.fullName">
            <button
              @click="selectModel(model.fullName)"
              :class="{'selected': selectedModel === model.fullName}"
              class="model-item"
             >
              <span class="model-name" x-text="model.name"></span>
              <span x-show="model.details" class="model-details" x-text="model.details"></span>
            </button>
          </template>
        </div>
      </div>
    </template>

    <div x-show="filteredModels.length === 0" class="no-results">
      No models found matching "<span x-text="searchTerm"></span>"
    </div>
  </div>
</div>

<script>
function modelSelector() {
  return {
    models: [],
    loading: false,
    searchTerm: '',
    selectedProvider: 'all',
    selectedModel: '',
    
    get providers() {
      const unique = [...new Set(this.models.map(m => m.provider))];
      return unique.sort();
    },
    
    get filteredModels() {
      return this.models.filter(model => {
        const matchesSearch = 
          !this.searchTerm || 
          model.name.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
          model.fullName.toLowerCase().includes(this.searchTerm.toLowerCase());
        
        const matchesProvider = 
          this.selectedProvider === 'all' || 
          model.provider === this.selectedProvider;
        
        return matchesSearch && matchesProvider;
      });
    },
    
    get groupedModels() {
      return this.filteredModels.reduce((acc, model) => {
        const provider = model.provider || 'other';
        if (!acc[provider]) {
          acc[provider] = [];
        }
        acc[provider].push(model);
        return acc;
      }, {});
    },
    
    getProviderCount(provider) {
      return this.models.filter(m => m.provider === provider).length;
    },
    
    selectModel(fullName) {
      this.selectedModel = fullName;
      // Dispatch event or call callback
      this.$dispatch('model-selected', { model: fullName });
    },
    
    async loadModels() {
      this.loading = true;
      try {
        const response = await fetch('http://localhost:8080/api/models', {
          headers: { 
            'Authorization': `Bearer ${API_KEY}` 
          }
        });
        const data = await response.json();
        this.models = data.models.filter(m => m.provider);
      } catch (error) {
        console.error('Failed to load models:', error);
      } finally {
        this.loading = false;
      }
    }
  };
}
</script>
```

## Recommended CSS

```css
.model-selector {
  max-width: 800px;
  margin: 0 auto;
}

.controls {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.search-input {
  flex: 1;
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 0.5rem;
  font-size: 0.875rem;
}

.provider-filter {
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  border-radius: 0.5rem;
  background: white;
  cursor: pointer;
}

.model-list {
  max-height: 600px;
  overflow-y: auto;
  border: 1px solid #ddd;
  border-radius: 0.5rem;
  padding: 1rem;
}

.provider-group {
  margin-bottom: 2rem;
}

.provider-group h3 {
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  color: #666;
  margin-bottom: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #eee;
}

.models {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 0.5rem;
}

.model-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 0.375rem;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.model-item:hover {
  border-color: #ef4444;
  background: #fef2f2;
}

.model-item.selected {
  border-color: #ef4444;
  background: #fee2e2;
  font-weight: 600;
}

.model-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #1f2937;
}

.model-details {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 0.25rem;
}

.no-results {
  text-align: center;
  padding: 2rem;
  color: #6b7280;
}
```

## Provider Categories

The 600+ models come from these providers:

### Major Providers
- **openai** - GPT-4, GPT-5, O-series, Codex models
- **anthropic** - Claude 3, Claude 4, Claude Opus/Sonnet/Haiku
- **google** - Gemini 1.5, 2.0, 2.5, 3.0 Pro/Flash
- **openrouter** - 400+ models from various providers
- **mistral** - Mistral Large, Medium, Small, Codestral, Devstral

### Cloud Providers
- **amazon-bedrock** - 70+ models via AWS Bedrock
- **azure-openai-responses** - Azure-hosted OpenAI models
- **google-vertex** - Vertex AI models
- **vercel-ai-gateway** - 100+ models via Vercel

### Specialized Providers
- **xai** - Grok 2, 3, 4, Code models
- **groq** - Fast inference models
- **cerebras** - Ultra-fast inference
- **huggingface** - Open source models

### Chinese Providers
- **zai** - GLM-4, GLM-5 models
- **minimax** - MiniMax M2, M2.1, M2.5
- **kimi-coding** - Kimi K2, K2.5 Thinking models
- **qwen** (via openrouter) - Qwen 3, Qwen 3.5 models

## Recommended Filtering Strategy

For best UX with 600+ models:

1. **Start with Popular Providers**: Default to OpenAI, Anthropic, Google
2. **Show Model Count**: Display count per provider
3. **Smart Search**: Search across name and provider
4. **Favorites System**: Let users mark favorites
5. **Recent Models**: Show recently used models
6. **Recommended Badge**: Mark recommended models for specific use cases

## Performance Optimization

```javascript
// Cache models in localStorage
const CACHE_KEY = 'openclaw_models_cache';
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

async function fetchModelsWithCache(apiKey) {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_DURATION) {
      return data;
    }
  }

  const response = await fetch('http://localhost:8080/api/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  const data = await response.json();
  const models = data.models.filter(m => m.provider);

  localStorage.setItem(CACHE_KEY, JSON.stringify({
    data: models,
    timestamp: Date.now()
  }));

  return models;
}
```

## Provider-Specific Filtering

```javascript
// Recommended providers for different use cases
const USE_CASE_RECOMMENDATIONS = {
  'general-chat': ['openai/gpt-5.1-codex', 'anthropic/claude-sonnet-4-6', 'google/gemini-3-pro-preview'],
  'coding': ['openai/gpt-5.1-codex-max', 'anthropic/claude-opus-4-6', 'opencode/gpt-5.2-codex'],
  'research': ['openai/o3-deep-research', 'anthropic/claude-opus-4-6', 'google/gemini-3-pro-preview'],
  'fast-inference': ['cerebras/gpt-oss-120b', 'groq/llama-3.3-70b-versatile', 'openai/gpt-5-mini'],
  'cost-effective': ['openrouter/openai/gpt-oss-20b:free', 'google/gemini-2.5-flash-lite', 'groq/llama-3.1-8b-instant'],
  'multimodal': ['openai/gpt-5.1-codex', 'google/gemini-3-pro-preview', 'anthropic/claude-opus-4-6']
};

function getRecommendedModels(useCase) {
  return USE_CASE_RECOMMENDATIONS[useCase] || [];
}
```

## Complete Integration Example

See `/app/src/public/setup.html` for a working implementation that:
- Fetches models on provider selection
- Groups by provider
- Supports dropdown and custom input
- Integrates with configuration API
- Handles loading states
- Provides search/filter

This file has been updated with the new model fetching logic that uses `--all` flag.

## Testing

```bash
# Fetch all models
curl -H "Authorization: Bearer YOUR_KEY" http://localhost:8080/api/models

# Filter by provider
curl -H "Authorization: Bearer YOUR_KEY" "http://localhost:8080/api/models?provider=openai"

# Count models per provider
curl -s -H "Authorization: Bearer YOUR_KEY" \
  http://localhost:8080/api/models | \
  jq -r '.models[] | select(.provider != null) | .provider' | \
  sort | uniq -c | sort -rn
```
