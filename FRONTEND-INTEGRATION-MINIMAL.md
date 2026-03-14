# Minimal Frontend Integration for Custom Skills

This document is for a **separate React repository** that deploys agents with custom skills.

## Overview

Your React app calls Railway API to:
1. Set `ADDITIONAL_SKILLS` environment variable
2. Trigger a redeploy

Railway rebuilds the Docker image with selected skills baked in.

---

## What You Need

### 1. Environment Variables (React `.env`)

```bash
# Railway API credentials - get these from Railway dashboard
REACT_APP_RAILWAY_TOKEN=your_railway_api_token
REACT_APP_RAILWAY_PROJECT_ID=your_project_id
REACT_APP_RAILWAY_ENVIRONMENT_ID=your_environment_id
REACT_APP_RAILWAY_SERVICE_ID=your_service_id
```

### 2. Get Railway IDs

**Option A - Via Railway CLI:**
```bash
npm install -g @railway/cli
railway login
railway status  # Shows all IDs
```

**Option B - From Railway Dashboard URL:**
```
https://railway.app/project/PROJECT_ID/environment/ENVIRONMENT_ID/service/SERVICE_ID
```

**Option C - GraphQL Query:**
```bash
curl -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ me { projects { edges { node { id name } } } } }"
  }'
```

---

## Frontend Code

### Simple JavaScript Function

```javascript
const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

/**
 * Deploy agent with custom skills
 * @param {string[]} skills - e.g., ['twitter', 'telegram', 'weather']
 */
async function deployWithSkills(skills) {
  const token = process.env.REACT_APP_RAILWAY_TOKEN;
  const projectId = process.env.REACT_APP_RAILWAY_PROJECT_ID;
  const envId = process.env.REACT_APP_RAILWAY_ENVIRONMENT_ID;
  const serviceId = process.env.REACT_APP_RAILWAY_SERVICE_ID;
  
  const skillsString = skills.join(' ');
  
  // Step 1: Set ADDITIONAL_SKILLS env var
  await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        mutation($input: VariableUpsertInput!) {
          variableUpsert(input: $input)
        }
      `,
      variables: {
        input: {
          projectId,
          environmentId: envId,
          serviceId,
          name: 'ADDITIONAL_SKILLS',
          value: skillsString
        }
      }
    })
  });
  
  // Step 2: Trigger redeploy
  await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        mutation($serviceId: String!, $environmentId: String!) {
          serviceInstanceRedeploy(
            serviceId: $serviceId
            environmentId: $environmentId
          )
        }
      `,
      variables: { serviceId, environmentId: envId }
    })
  });
  
  console.log('✓ Deployment started with skills:', skills);
}

// Usage:
deployWithSkills(['twitter', 'telegram', 'weather']);
```

---

## React Component Example

```jsx
import { useState } from 'react';

const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

export default function SkillSelector() {
  const [skills, setSkills] = useState([]);
  const [deploying, setDeploying] = useState(false);
  
  const availableSkills = ['twitter', 'telegram', 'weather', 'github', 'discord'];
  const defaultSkills = ['duckduckgo-search', 'polymarket-odds', 'hyperliquid-cli', 'onchain'];
  
  const toggleSkill = (skill) => {
    setSkills(prev => 
      prev.includes(skill) 
        ? prev.filter(s => s !== skill)
        : [...prev, skill]
    );
  };
  
  const deploy = async () => {
    setDeploying(true);
    try {
      const token = process.env.REACT_APP_RAILWAY_TOKEN;
      const projectId = process.env.REACT_APP_RAILWAY_PROJECT_ID;
      const envId = process.env.REACT_APP_RAILWAY_ENVIRONMENT_ID;
      const serviceId = process.env.REACT_APP_RAILWAY_SERVICE_ID;
      
      // Set env var
      await fetch(RAILWAY_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: 'mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
          variables: {
            input: {
              projectId,
              environmentId: envId,
              serviceId,
              name: 'ADDITIONAL_SKILLS',
              value: skills.join(' ')
            }
          }
        })
      });
      
      // Redeploy
      await fetch(RAILWAY_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: 'mutation($serviceId: String!, $environmentId: String!) { serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId) }',
          variables: { serviceId, environmentId: envId }
        })
      });
      
      alert('✓ Deploying with skills: ' + skills.join(', '));
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setDeploying(false);
    }
  };
  
  return (
    <div>
      <h3>Default Skills (Always Included)</h3>
      <ul>
        {defaultSkills.map(s => <li key={s}>{s}</li>)}
      </ul>
      
      <h3>Additional Skills</h3>
      {availableSkills.map(skill => (
        <label key={skill}>
          <input 
            type="checkbox" 
            checked={skills.includes(skill)}
            onChange={() => toggleSkill(skill)}
          />
          {skill}
        </label>
      ))}
      
      <button onClick={deploy} disabled={deploying}>
        {deploying ? 'Deploying...' : 'Deploy Agent'}
      </button>
    </div>
  );
}
```

---

## Available Skills

**Default Skills** (always installed):
- `duckduckgo-search` - Web search
- `polymarket-odds` - Market odds
- `hyperliquid-cli` - Trading
- `onchain` - Blockchain data

**Example Additional Skills** (frontend can add):
- `twitter` - Twitter integration
- `telegram` - Telegram bot
- `weather` - Weather forecasts
- `github` - GitHub API
- `discord` - Discord bot
- `email` - Email capabilities

*Note: Check ClawHub registry for available skills: https://clawhub.ai*

---

## How It Works

1. **Frontend** sets `ADDITIONAL_SKILLS` env var via Railway API
2. **Railway** triggers rebuild reading `railway.toml`:
   ```toml
   [build.buildArgs]
   ADDITIONAL_SKILLS = "${{ADDITIONAL_SKILLS}}"
   ```
3. **Dockerfile** installs skills during build:
   ```dockerfile
   ARG ADDITIONAL_SKILLS=""
   RUN clawhub install $ADDITIONAL_SKILLS --workdir /opt/skills-cache
   ```
4. **Skills** are baked into Docker image at `/opt/skills-cache`

**Build time:** 3-5 minutes

---

## Testing the Integration

### Test Railway API Connection

```javascript
async function testRailwayAPI() {
  const token = process.env.REACT_APP_RAILWAY_TOKEN;
  
  const response = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: '{ me { name email } }'
    })
  });
  
  const data = await response.json();
  console.log('Railway API working:', data);
}
```

### Test Skill Deployment

```javascript
// Deploy with test skills
await deployWithSkills(['weather']);

// Check Railway dashboard to see:
// - ADDITIONAL_SKILLS env var is set
// - New deployment is triggered
// - Build logs show: "Installing: weather"
```

---

## Error Handling

```javascript
async function deployWithSkills(skills) {
  try {
    // ... API calls ...
    
    return { success: true, skills };
    
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      throw new Error('Invalid Railway token');
    }
    if (error.message.includes('Not found')) {
      throw new Error('Project/Service not found - check IDs');
    }
    throw error;
  }
}
```

---

## Summary

**What the frontend does:**
```javascript
// 1. Set env var
POST https://backboard.railway.app/graphql/v2
  mutation: variableUpsert(name: "ADDITIONAL_SKILLS", value: "twitter telegram")

// 2. Trigger redeploy  
POST https://backboard.railway.app/graphql/v2
  mutation: serviceInstanceRedeploy(serviceId, environmentId)
```

**What happens:**
- Railway rebuilds Docker image
- Skills installed to `/opt/skills-cache`
- New deployment live in 3-5 minutes

**Zero dependencies** - just `fetch` and Railway API token!
