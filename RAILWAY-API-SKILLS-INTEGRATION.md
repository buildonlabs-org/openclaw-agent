# Railway API Integration for Custom Skills

Frontend uses Railway GraphQL API to set environment variables and trigger deployments.

## How It Works

1. **Frontend** sets `ADDITIONAL_SKILLS` environment variable via Railway API
2. **railway.toml** passes this to Docker as a build arg
3. **Dockerfile** installs skills during build to `/opt/skills-cache`
4. Skills are baked into the image (no runtime installation)

## Frontend Implementation

### Complete Function

```javascript
const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';

/**
 * Deploy agent with custom skills using Railway API
 * @param {string[]} additionalSkills - Array of skill names
 * @returns {Promise<object>} Deployment result
 */
const deployAgentWithSkills = async (additionalSkills = []) => {
  const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN; // Your Railway API token
  const PROJECT_ID = 'your-project-id';
  const ENVIRONMENT_ID = 'your-environment-id';
  const SERVICE_ID = 'your-service-id';
  
  // Convert skills array to space-separated string
  const skillsArg = additionalSkills.join(' '); // ['twitter', 'weather'] => "twitter weather"
  
  try {
    // Step 1: Set/Update ADDITIONAL_SKILLS environment variable
    const updateVarsMutation = `
      mutation VariableUpsert($input: VariableUpsertInput!) {
        variableUpsert(input: $input)
      }
    `;
    
    const varsResponse = await fetch(RAILWAY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: updateVarsMutation,
        variables: {
          input: {
            projectId: PROJECT_ID,
            environmentId: ENVIRONMENT_ID,
            serviceId: SERVICE_ID,
            name: 'ADDITIONAL_SKILLS',
            value: skillsArg
          }
        }
      })
    });
    
    const varsResult = await varsResponse.json();
    console.log('✓ Environment variable set:', varsResult);
    
    // Step 2: Trigger rebuild/redeploy
    const redeployMutation = `
      mutation ServiceInstanceRedeploy(
        $serviceId: String!
        $environmentId: String!
      ) {
        serviceInstanceRedeploy(
          serviceId: $serviceId
          environmentId: $environmentId
        )
      }
    `;
    
    const deployResponse = await fetch(RAILWAY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: redeployMutation,
        variables: {
          serviceId: SERVICE_ID,
          environmentId: ENVIRONMENT_ID
        }
      })
    });
    
    const deployResult = await deployResponse.json();
    console.log('✓ Deployment triggered:', deployResult);
    
    return {
      success: true,
      skills: additionalSkills,
      deploymentId: deployResult.data?.serviceInstanceRedeploy
    };
    
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    throw error;
  }
};

// Usage:
await deployAgentWithSkills(['twitter', 'telegram', 'weather']);
```

## React Component

```jsx
import React, { useState } from 'react';

const RAILWAY_API_URL = 'https://backboard.railway.app/graphql/v2';

const AgentSkillsDeployer = () => {
  const [selectedSkills, setSelectedSkills] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [status, setStatus] = useState('');
  
  const availableSkills = [
    { id: 'twitter', name: 'Twitter', desc: 'Post and read tweets' },
    { id: 'telegram', name: 'Telegram', desc: 'Send messages' },
    { id: 'weather', name: 'Weather', desc: 'Get forecasts' },
    { id: 'github', name: 'GitHub', desc: 'Repo interactions' },
    { id: 'discord', name: 'Discord', desc: 'Bot features' },
    { id: 'email', name: 'Email', desc: 'Send/read emails' }
  ];
  
  const defaultSkills = [
    'duckduckgo-search',
    'polymarket-odds',
    'hyperliquid-cli',
    'onchain'
  ];
  
  const toggleSkill = (skillId) => {
    setSelectedSkills(prev =>
      prev.includes(skillId)
        ? prev.filter(s => s !== skillId)
        : [...prev, skillId]
    );
  };
  
  const deployAgent = async () => {
    setIsDeploying(true);
    setStatus('Setting environment variable...');
    
    try {
      const RAILWAY_TOKEN = process.env.REACT_APP_RAILWAY_TOKEN;
      const PROJECT_ID = process.env.REACT_APP_RAILWAY_PROJECT_ID;
      const ENVIRONMENT_ID = process.env.REACT_APP_RAILWAY_ENVIRONMENT_ID;
      const SERVICE_ID = process.env.REACT_APP_RAILWAY_SERVICE_ID;
      
      const skillsArg = selectedSkills.join(' ');
      
      // Set environment variable
      setStatus('Updating configuration...');
      const varsResponse = await fetch(RAILWAY_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RAILWAY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `
            mutation VariableUpsert($input: VariableUpsertInput!) {
              variableUpsert(input: $input)
            }
          `,
          variables: {
            input: {
              projectId: PROJECT_ID,
              environmentId: ENVIRONMENT_ID,
              serviceId: SERVICE_ID,
              name: 'ADDITIONAL_SKILLS',
              value: skillsArg
            }
          }
        })
      });
      
      const varsResult = await varsResponse.json();
      if (varsResult.errors) {
        throw new Error(varsResult.errors[0].message);
      }
      
      // Trigger redeploy
      setStatus('Building Docker image with skills...');
      const deployResponse = await fetch(RAILWAY_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RAILWAY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `
            mutation ServiceInstanceRedeploy(
              $serviceId: String!
              $environmentId: String!
            ) {
              serviceInstanceRedeploy(
                serviceId: $serviceId
                environmentId: $environmentId
              )
            }
          `,
          variables: {
            serviceId: SERVICE_ID,
            environmentId: ENVIRONMENT_ID
          }
        })
      });
      
      const deployResult = await deployResponse.json();
      if (deployResult.errors) {
        throw new Error(deployResult.errors[0].message);
      }
      
      setStatus('✓ Deployed! Building with skills: ' + selectedSkills.join(', '));
      setTimeout(() => setStatus(''), 5000);
      
    } catch (error) {
      setStatus(`❌ Error: ${error.message}`);
    } finally {
      setIsDeploying(false);
    }
  };
  
  return (
    <div style={{ padding: '20px', maxWidth: '600px' }}>
      <h2>🤖 Configure Agent Skills</h2>
      
      <div style={{ 
        background: '#f5f5f5', 
        padding: '15px', 
        borderRadius: '5px', 
        marginBottom: '20px' 
      }}>
        <h4>Default Skills (Always Included)</h4>
        <ul>
          {defaultSkills.map(skill => (
            <li key={skill}>{skill}</li>
          ))}
        </ul>
      </div>
      
      <h4>Additional Skills</h4>
      <div style={{ display: 'grid', gap: '10px', marginBottom: '20px' }}>
        {availableSkills.map(skill => (
          <label 
            key={skill.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px',
              border: '1px solid #ddd',
              borderRadius: '5px',
              cursor: 'pointer',
              background: selectedSkills.includes(skill.id) ? '#e3f2fd' : 'white'
            }}
          >
            <input
              type="checkbox"
              checked={selectedSkills.includes(skill.id)}
              onChange={() => toggleSkill(skill.id)}
              style={{ marginRight: '10px' }}
            />
            <div>
              <strong>{skill.name}</strong>
              <div style={{ fontSize: '0.9em', color: '#666' }}>
                {skill.desc}
              </div>
            </div>
          </label>
        ))}
      </div>
      
      <button
        onClick={deployAgent}
        disabled={isDeploying}
        style={{
          padding: '12px 24px',
          background: isDeploying ? '#ccc' : '#1976d2',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: isDeploying ? 'not-allowed' : 'pointer',
          fontSize: '16px',
          fontWeight: 'bold'
        }}
      >
        {isDeploying ? 'Deploying...' : 'Deploy Agent'}
      </button>
      
      {status && (
        <div style={{
          marginTop: '15px',
          padding: '10px',
          background: status.includes('✓') ? '#d4edda' : '#f8d7da',
          color: status.includes('✓') ? '#155724' : '#721c24',
          borderRadius: '5px'
        }}>
          {status}
        </div>
      )}
      
      {selectedSkills.length > 0 && (
        <div style={{ marginTop: '15px', color: '#666' }}>
          Selected: <strong>{selectedSkills.join(', ')}</strong>
        </div>
      )}
    </div>
  );
};

export default AgentSkillsDeployer;
```

## Environment Variables

In your React app's `.env`:

```bash
# Railway API credentials
REACT_APP_RAILWAY_TOKEN=your_railway_token_here
REACT_APP_RAILWAY_PROJECT_ID=your_project_id
REACT_APP_RAILWAY_ENVIRONMENT_ID=your_environment_id
REACT_APP_RAILWAY_SERVICE_ID=your_service_id
```

### Getting Railway IDs

#### Via Railway CLI:
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Get project info
railway status

# Output will show:
# Project: your-project-name (project-id)
# Environment: production (environment-id)
# Service: openclaw-agent (service-id)
```

#### Via Railway Dashboard:
1. Open your Railway project
2. Go to Settings
3. Copy Project ID
4. Select your environment (e.g., production)
5. Copy Environment ID from URL: `https://railway.app/project/PROJECT_ID/environment/ENVIRONMENT_ID`
6. Select your service
7. Copy Service ID  from URL or GraphQL query

#### Via GraphQL Query:
```graphql
query {
  me {
    projects {
      edges {
        node {
          id
          name
          environments {
            edges {
              node {
                id
                name
                serviceInstances {
                  edges {
                    node {
                      serviceId
                      serviceName
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## How Railway Processes the Build

1. **Frontend** calls Railway API to set `ADDITIONAL_SKILLS="twitter telegram weather"`
2. **Frontend** triggers redeploy
3. **Railway** reads `railway.toml` → sees `ADDITIONAL_SKILLS = "${{ADDITIONAL_SKILLS}}"`
4. **Railway** passes value to Docker: `docker build --build-arg ADDITIONAL_SKILLS="twitter telegram weather"`
5. **Dockerfile** installs common skills + additional skills to `/opt/skills-cache`
6. **Skills** are baked into the Docker image permanently

## Build Time

- **Initial build**: ~5-8 minutes
- **Subsequent builds**: ~3-5 minutes (Docker layer caching)
- **Per skill**: ~5-15 seconds each

## Example Build Output

```
=== Skill Installation to /opt/skills-cache ===
Common skills: duckduckgo-search polymarket-odds hyperliquid-cli onchain
Additional skills: twitter telegram weather

→ Installing: duckduckgo-search
✓ Installed duckduckgo-search
→ Installing: polymarket-odds
✓ Installed polymarket-odds
→ Installing: hyperliquid-cli
✓ Installed hyperliquid-cli
→ Installing: onchain
✓ Installed onchain
Installing additional skills...
  → Installing: twitter
✓ Installed twitter
  → Installing: telegram
✓ Installed telegram
  → Installing: weather
✓ Installed weather

✓ Skill cache setup complete
Installed skills:
total 28K
drwxr-xr-x 7 root root 4.0K duckduckgo-search
drwxr-xr-x 7 root root 4.0K polymarket-odds
drwxr-xr-x 7 root root 4.0K hyperliquid-cli
drwxr-xr-x 7 root root 4.0K onchain
drwxr-xr-x 7 root root 4.0K twitter
drwxr-xr-x 7 root root 4.0K telegram
drwxr-xr-x 7 root root 4.0K weather
```

## Testing Locally

Test with Docker:

```bash
# Build with additional skills
docker build \
  --build-arg ADDITIONAL_SKILLS="twitter telegram weather" \
  -t openclaw-agent:test \
  .

# Verify skills installed
docker run --rm openclaw-agent:test ls -la /opt/skills-cache/skills

# Run the container
docker run -p 8080:8080 \
  -e SETUP_PASSWORD=test123 \
  openclaw-agent:test
```

## Error Handling

```javascript
const deployWithErrorHandling = async (skills) => {
  try {
    setStatus('Validating skills...');
    
    // Validate skill names (optional)
    const validSkills = skills.filter(s => /^[a-z0-9-]+$/.test(s));
    if (validSkills.length !== skills.length) {
      throw new Error('Invalid skill names detected');
    }
    
    setStatus('Updating Railway configuration...');
    const result = await deployAgentWithSkills(validSkills);
    
    setStatus(`✓ Success! Deployment ID: ${result.deploymentId}`);
    
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      setStatus('❌ Invalid Railway token');
    } else if (error.message.includes('Not found')) {
      setStatus('❌ Project/Service not found');
    } else {
      setStatus(`❌ Error: ${error.message}`);
    }
  }
};
```

## Summary

**What Frontend Does:**
1. Set `ADDITIONAL_SKILLS` env var via Railway API
2. Trigger redeploy via Railway API
3. Wait for build to complete (~3-5 minutes)

**What Happens:**
- Railway builds Docker image with skills
- Skills permanently cached in `/opt/skills-cache`
- New deployment goes live with all skills ready

**No need for:**
- GitHub API access
- File commits
- Complex configuration
- Runtime installation

Just two API calls and you're done! 🚀
