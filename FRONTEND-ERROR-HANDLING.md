# Frontend Error Handling for Skill Requirements

## Overview

When users try to use skills without proper API keys configured, the `/api/chat` endpoint returns a specific error response. This guide shows you how to detect and handle it.

## Error Response Format

### Status Code
`400 Bad Request`

### Response Body
```json
{
  "ok": false,
  "error": "Skill requirements not configured",
  "skills": ["polymarket-odds", "twitter"],
  "missingRequirements": [
    {
      "skill": "polymarket-odds",
      "requiredVars": ["POLYMARKET_API_KEY", "POLYMARKET_PRIVATE_KEY"],
      "missingVars": ["POLYMARKET_API_KEY", "POLYMARKET_PRIVATE_KEY"],
      "anyOf": true,
      "setupInstructions": "⚠️ **Polymarket Skill Requires API Credentials**\n\n..."
    }
  ],
  "missingVars": ["POLYMARKET_API_KEY", "POLYMARKET_PRIVATE_KEY"],
  "setupInstructions": "⚠️ **Polymarket Skill Requires API Credentials**\n\nTo use Polymarket skill, add ONE of these API keys:\n- `POLYMARKET_API_KEY` - Get from polymarket.com/settings\n- `POLYMARKET_PRIVATE_KEY` - Your Polymarket wallet private key\n\n**Steps:**\n1. Go to Settings\n2. Add the API key\n3. Save changes\n",
  "helpUrl": "https://github.com/buildonlabs-org/openclaw-agent#environment-variables",
  "originalResponse": "It seems that I'm unable to..."
}
```

## Frontend Implementation

### Basic Handling

```typescript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message: userMessage })
});

const data = await response.json();

if (!data.ok && data.error === 'Skill requirements not configured') {
  // Show setup instructions to user
  showConfigurationModal(data);
} else if (data.ok) {
  // Display normal response
  displayMessage(data.response);
}
```

### React Example

```tsx
function ChatResponse({ data }) {
  if (!data.ok && data.error === 'Skill requirements not configured') {
    return (
      <div className="config-required">
        <h3>⚙️ Configuration Required</h3>
        <div className="skills-list">
          <strong>Skills needing setup:</strong>
          <ul>
            {data.skills.map(skill => (
              <li key={skill}>{skill}</li>
            ))}
          </ul>
        </div>
        <div className="setup-instructions">
          <ReactMarkdown>{data.setupInstructions}</ReactMarkdown>
        </div>
        <button onClick={() => navigate('/settings')}>
          Go to Settings
        </button>
      </div>
    );
  }

  return <div className="message">{data.response}</div>;
}
```

### Vue Example

```vue
<template>
  <div v-if="needsConfiguration" class="config-alert">
    <h3>⚙️ Configuration Required</h3>
    <p>The following skills need API keys:</p>
    <ul>
      <li v-for="skill in configData.skills" :key="skill">
        {{ skill }}
      </li>
    </ul>
    <div v-html="markdownToHtml(configData.setupInstructions)"></div>
    <button @click="$router.push('/settings')">Go to Settings</button>
  </div>
  <div v-else class="message">{{ response }}</div>
</template>

<script>
export default {
  computed: {
    needsConfiguration() {
      return !this.data.ok && this.data.error === 'Skill requirements not configured';
    }
  }
}
</script>
```

## Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Always `false` for this error |
| `error` | string | Always `"Skill requirements not configured"` |
| `skills` | string[] | Array of skill slugs needing configuration |
| `missingVars` | string[] | Flat list of all missing environment variables |
| `setupInstructions` | string | Markdown-formatted setup guide (user-friendly) |
| `missingRequirements` | object[] | Detailed requirements per skill |
| `helpUrl` | string | Link to full documentation |

## UI Recommendations

### 1. Modal/Dialog
Show setup instructions in a modal with:
- Clear heading
- List of missing skills
- Formatted instructions (render markdown)
- Button to go to Settings
- Optional: "Remind me later" button

### 2. Inline Banner
Display a banner above the chat:
```
⚠️ Some features require configuration
Skills needed: polymarket-odds, twitter
[Go to Settings] [Learn More]
```

### 3. Settings Badge
Add a badge/indicator on Settings icon showing number of unconfigured skills.

## Complete Example

```typescript
async function sendChatMessage(message: string) {
  try {
    const response = await fetch(`${agentUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message })
    });

    const data = await response.json();

    // Check for configuration error
    if (!data.ok && data.error === 'Skill requirements not configured') {
      return {
        type: 'config_required',
        skills: data.skills,
        instructions: data.setupInstructions,
        missingVars: data.missingVars,
        helpUrl: data.helpUrl
      };
    }

    // Normal response
    if (data.ok) {
      return {
        type: 'success',
        message: data.response,
        cronDetected: data.cronDetected
      };
    }

    // Other error
    return {
      type: 'error',
      message: data.error || 'Unknown error'
    };

  } catch (error) {
    return {
      type: 'error',
      message: error.message
    };
  }
}

// Usage
const result = await sendChatMessage("trade on polymarket");

switch (result.type) {
  case 'config_required':
    showConfigModal(result);
    break;
  case 'success':
    displayMessage(result.message);
    break;
  case 'error':
    showError(result.message);
    break;
}
```

## Markdown Rendering

The `setupInstructions` field contains markdown. Use a markdown renderer:

**React:**
```tsx
import ReactMarkdown from 'react-markdown';

<ReactMarkdown>{data.setupInstructions}</ReactMarkdown>
```

**Vue:**
```javascript
import { marked } from 'marked';

computed: {
  instructionsHtml() {
    return marked(this.data.setupInstructions);
  }
}
```

**Plain JavaScript:**
```javascript
import { marked } from 'marked';

const html = marked(data.setupInstructions);
element.innerHTML = html;
```

## Testing

To test this flow without actually missing API keys:

1. Remove an API key temporarily from Settings
2. Send a message that uses that skill
3. Verify the error response appears
4. Add the API key back
5. Verify the message now works

## Summary

✅ Always check `data.ok` and `data.error === 'Skill requirements not configured'`  
✅ Display `setupInstructions` as markdown  
✅ Provide a button/link to Settings  
✅ Show which skills need configuration (`skills` array)  
✅ Optional: Show specific missing variables (`missingVars`)  
✅ Link to help docs (`helpUrl`)

This provides a smooth user experience when API keys are missing!
