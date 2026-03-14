# Simple Frontend Integration for Custom Skills

## How It Works (Super Simple!)

1. Frontend updates `skills-config.json` in this repo via GitHub API
2. Railway auto-detects the change and rebuilds the Docker image
3. New skills are baked into the image at `/opt/skills-cache`

That's it! No Railway API needed, no complex config.

## Frontend Implementation

### Install Dependencies

```bash
npm install @octokit/rest
```

### React Component & API Call

```javascript
import { Octokit } from '@octokit/rest';

// Initialize GitHub client
const octokit = new Octokit({
  auth: process.env.REACT_APP_GITHUB_TOKEN // GitHub Personal Access Token
});

const REPO_OWNER = 'buildonlabs-org';
const REPO_NAME = 'openclaw-agent';
const CONFIG_FILE = 'skills-config.json';
const BRANCH = 'main'; // or user's branch

/**
 * Deploy agent with custom skills
 * @param {string[]} additionalSkills - Array of skill names to add
 * @returns {Promise<string>} Commit SHA
 */
const deployAgentWithSkills = async (additionalSkills) => {
  try {
    // 1. Get current skills-config.json
    const { data: fileData } = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: CONFIG_FILE,
      ref: BRANCH
    });
    
    // 2. Decode and parse current config
    const currentContent = Buffer.from(fileData.content, 'base64').toString();
    const config = JSON.parse(currentContent);
    
    // 3. Update additionalSkills
    config.additionalSkills = additionalSkills;
    
    // 4. Commit the change
    const { data: commitData } = await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: CONFIG_FILE,
      message: `Update agent skills: ${additionalSkills.join(', ')}`,
      content: Buffer.from(JSON.stringify(config, null, 2)).toString('base64'),
      sha: fileData.sha,
      branch: BRANCH
    });
    
    console.log('✓ Config updated, Railway will auto-deploy');
    return commitData.commit.sha;
    
  } catch (error) {
    console.error('Failed to update skills:', error);
    throw error;
  }
};

// Usage in your React component:
const handleDeploy = async () => {
  const selectedSkills = ['twitter', 'telegram', 'weather'];
  
  try {
    await deployAgentWithSkills(selectedSkills);
    alert('Agent deploying with new skills! Check Railway for progress.');
  } catch (error) {
    alert('Failed to deploy: ' + error.message);
  }
};
```

## Complete React Component

```jsx
import React, { useState } from 'react';
import { Octokit } from '@octokit/rest';

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
    setStatus('Updating configuration...');
    
    try {
      const octokit = new Octokit({
        auth: process.env.REACT_APP_GITHUB_TOKEN
      });
      
      // Get current config
      const { data: fileData } = await octokit.repos.getContent({
        owner: 'buildonlabs-org',
        repo: 'openclaw-agent',
        path: 'skills-config.json',
        ref: 'main'
      });
      
      // Update config
      const config = JSON.parse(
        Buffer.from(fileData.content, 'base64').toString()
      );
      config.additionalSkills = selectedSkills;
      
      // Commit change
      await octokit.repos.createOrUpdateFileContents({
        owner: 'buildonlabs-org',
        repo: 'openclaw-agent',
        path: 'skills-config.json',
        message: `Deploy agent with skills: ${selectedSkills.join(', ')}`,
        content: Buffer.from(JSON.stringify(config, null, 2)).toString('base64'),
        sha: fileData.sha,
        branch: 'main'
      });
      
      setStatus('✓ Deployed! Railway is building with your skills.');
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
      
      <div style={{ background: '#f5f5f5', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
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
              <div style={{ fontSize: '0.9em', color: '#666' }}>{skill.desc}</div>
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
REACT_APP_GITHUB_TOKEN=ghp_your_token_here
```

### Creating GitHub Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token
3. Select scopes: `repo` (Full control of private repositories)
4. Copy token and add to `.env`

## How Railway Auto-Deploys

When you commit to `skills-config.json`:
1. Railway detects the Git push
2. Automatically triggers a new build
3. Dockerfile reads the updated `skills-config.json`
4. Installs all skills to `/opt/skills-cache`
5. New deployment goes live

**Build time:** ~3-5 minutes (depending on number of skills)

## Per-User Deployments (Optional)

If you want each user to have their own agent configuration:

```javascript
const deployUserAgent = async (userId, skills) => {
  const userBranch = `user-${userId}`;
  
  // 1. Create branch for user (if doesn't exist)
  // 2. Update skills-config.json on that branch
  // 3. Railway deploys from user's branch
  
  // Each user gets their own branch and deployment!
};
```

## Testing Locally

Test the GitHub API integration:

```javascript
// test-github-api.js
const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({
  auth: 'your_token_here'
});

async function test() {
  try {
    // Test read
    const { data } = await octokit.repos.getContent({
      owner: 'buildonlabs-org',
      repo: 'openclaw-agent',
      path: 'skills-config.json'
    });
    
    console.log('✓ Can read config file');
    console.log(Buffer.from(data.content, 'base64').toString());
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test();
```

## Summary

**Frontend needs:**
1. GitHub token with repo access
2. Octokit npm package
3. One function to update `skills-config.json`

**That's it!** Railway handles the rest automatically.
