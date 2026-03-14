# Frontend Integration: Custom Skills Installation

This document explains how the frontend can deploy agents with custom pre-installed skills.

## How It Works

- **Common skills** (duckduckgo-search, polymarket-odds, hyperliquid-cli, onchain) are **always installed** during Docker build
- **Additional skills** can be specified by the frontend and are installed to `/opt/skills-cache` during build time
- Skills are baked into the Docker image, so no runtime installation delays or rate limits

## Option 1: Railway API (Recommended)

Use the Railway GraphQL API to update the service configuration and trigger a rebuild.

### Step 1: Update railway.toml via GitHub API

```javascript
// Update railway.toml with new skills
const updateRailwayToml = async (skills) => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const skillsString = skills.join(' ');
  
  // Read current railway.toml
  const getFileResponse = await fetch(
    'https://api.github.com/repos/buildonlabs-org/openclaw-agent/contents/railway.toml',
    {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  );
  
  const fileData = await getFileResponse.json();
  const currentContent = Buffer.from(fileData.content, 'base64').toString();
  
  // Update ADDITIONAL_SKILLS line
  const updatedContent = currentContent.replace(
    /ADDITIONAL_SKILLS = ".*"/,
    `ADDITIONAL_SKILLS = "${skillsString}"`
  );
  
  // Commit the change
  await fetch(
    'https://api.github.com/repos/buildonlabs-org/openclaw-agent/contents/railway.toml',
    {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Update skills: ${skillsString}`,
        content: Buffer.from(updatedContent).toString('base64'),
        sha: fileData.sha,
        branch: 'main' // or user's branch
      })
    }
  );
};
```

### Step 2: Trigger Railway Redeploy

```javascript
const triggerRailwayDeploy = async () => {
  const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN;
  const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';
  
  const mutation = `
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
  
  const response = await fetch(RAILWAY_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RAILWAY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        serviceId: 'YOUR_SERVICE_ID',
        environmentId: 'YOUR_ENVIRONMENT_ID'
      }
    })
  });
  
  return await response.json();
};
```

### Complete Function

```javascript
const deployAgentWithSkills = async (userId, skills) => {
  try {
    // Step 1: Update railway.toml in GitHub
    await updateRailwayToml(skills);
    
    // Step 2: Wait a moment for GitHub to process
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 3: Trigger Railway deploy (will rebuild with new skills)
    const result = await triggerRailwayDeploy();
    
    return {
      success: true,
      skills: skills,
      deploymentId: result.data?.serviceInstanceRedeploy
    };
  } catch (error) {
    console.error('Deployment failed:', error);
    throw error;
  }
};

// Usage:
await deployAgentWithSkills('user123', ['twitter', 'telegram', 'weather']);
```

## Option 2: Per-User Branches (Best for Multiple Users)

Create a separate branch for each user's agent deployment:

```javascript
const deployUserAgent = async (userId, skills) => {
  const branchName = `user-${userId}`;
  const skillsString = skills.join(' ');
  
  // 1. Create/update user's branch via GitHub API
  // 2. Update railway.toml on that branch
  // 3. Configure Railway service to deploy from that branch
  // 4. Trigger deployment
  
  // Each user gets their own branch with custom skills
  // railway.toml on user-123 branch has: ADDITIONAL_SKILLS = "twitter telegram"
  // railway.toml on user-456 branch has: ADDITIONAL_SKILLS = "weather github"
};
```

## Option 3: Railway Environment Variable (Doesn't Work with ARG)

⚠️ **Note**: Railway environment variables are not available to `ARG` during build by default. You would need to use a different approach like dynamically generating the Dockerfile.

## React Component Example

```jsx
import { useState } from 'react';

const AgentDeployer = ({ userId }) => {
  const [selectedSkills, setSelectedSkills] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState('');
  
  const availableSkills = [
    { id: 'twitter', name: 'Twitter', description: 'Post and read tweets' },
    { id: 'telegram', name: 'Telegram', description: 'Send Telegram messages' },
    { id: 'weather', name: 'Weather', description: 'Get weather forecasts' },
    { id: 'github', name: 'GitHub', description: 'Interact with GitHub' },
    { id: 'discord', name: 'Discord', description: 'Discord bot capabilities' },
    { id: 'email', name: 'Email', description: 'Send and read emails' }
  ];
  
  const toggleSkill = (skillId) => {
    setSelectedSkills(prev =>
      prev.includes(skillId)
        ? prev.filter(s => s !== skillId)
        : [...prev, skillId]
    );
  };
  
  const handleDeploy = async () => {
    setIsDeploying(true);
    setDeploymentStatus('Updating configuration...');
    
    try {
      setDeploymentStatus('Building Docker image with skills...');
      await deployAgentWithSkills(userId, selectedSkills);
      
      setDeploymentStatus('✓ Deployment successful!');
      setTimeout(() => setDeploymentStatus(''), 3000);
    } catch (error) {
      setDeploymentStatus(`❌ Error: ${error.message}`);
    } finally {
      setIsDeploying(false);
    }
  };
  
  return (
    <div className="agent-deployer">
      <h2>Configure Your Agent</h2>
      
      <div className="info-box">
        <h3>Pre-installed Skills</h3>
        <ul>
          <li>duckduckgo-search (Web search)</li>
          <li>polymarket-odds (Market odds)</li>
          <li>hyperliquid-cli (Trading)</li>
          <li>onchain (Blockchain data)</li>
        </ul>
      </div>
      
      <h3>Additional Skills</h3>
      <div className="skill-grid">
        {availableSkills.map(skill => (
          <div 
            key={skill.id} 
            className={`skill-card ${selectedSkills.includes(skill.id) ? 'selected' : ''}`}
            onClick={() => toggleSkill(skill.id)}
          >
            <input
              type="checkbox"
              checked={selectedSkills.includes(skill.id)}
              readOnly
            />
            <div>
              <strong>{skill.name}</strong>
              <p>{skill.description}</p>
            </div>
          </div>
        ))}
      </div>
      
      <div className="deploy-section">
        <button 
          onClick={handleDeploy}
          disabled={isDeploying}
          className="deploy-button"
        >
          {isDeploying ? 'Deploying...' : 'Deploy Agent'}
        </button>
        
        {deploymentStatus && (
          <div className="status-message">
            {deploymentStatus}
          </div>
        )}
        
        {selectedSkills.length > 0 && (
          <div className="selected-skills">
            Selected: {selectedSkills.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentDeployer;
```

## Expected Build Output

When Railway builds with `ADDITIONAL_SKILLS="twitter telegram weather"`, you'll see:

```
=== Skill Installation to /opt/skills-cache ===
Common skills: duckduckgo-search polymarket-odds hyperliquid-cli onchain
Additional skills: twitter telegram weather

Installing: duckduckgo-search
✓ Installed duckduckgo-search
Installing: polymarket-odds
✓ Installed polymarket-odds
Installing: hyperliquid-cli
✓ Installed hyperliquid-cli
Installing: onchain
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

Test the build locally with Docker:

```bash
# Build with additional skills
docker build \
  --build-arg ADDITIONAL_SKILLS="twitter telegram weather" \
  -t openclaw-agent:test \
  .

# Run the container
docker run -p 8080:8080 openclaw-agent:test

# Verify skills are installed
docker exec <container-id> ls -la /opt/skills-cache/skills
```

## Notes

- Each skill adds ~5-15 seconds to build time
- Skills are permanently cached in the Docker image
- Changing skills requires a full Docker rebuild
- Skills respect ClawHub rate limits (2-second delays between installs)
- Failed skill installations don't stop the build
