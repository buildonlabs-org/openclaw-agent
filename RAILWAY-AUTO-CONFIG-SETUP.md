# Wallet Persistence

## How It Works (100% Automatic)

OpenClaw agents use a **persistent volume** at `/data` to automatically save and restore the crypto wallet across deployments.

### Zero Configuration Required

1. **First Deployment**: Wallet is generated and saved to `/data/.openclaw/wallet.json`
2. **Future Deployments**: Same wallet is loaded automatically from the volume
3. **No Setup Needed**: Volume is pre-configured in `railway.toml`

```toml
# Already configured in railway.toml
[[volumes]]
name = "data"
mountPath = "/data"
sizeGB = 5
```

✅ **That's it!** The wallet just works automatically.

---

## Optional: Backup Your Wallet

While the volume handles persistence automatically, you may want to backup your wallet:

### Export Private Key

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://your-agent.up.railway.app/api/wallet/export?confirm=yes"
```

**Save this securely:**
- Password manager
- Hardware wallet
- Encrypted backup

### Restore from Backup

If you ever need to restore (volume deleted, migrating to new service, etc.):

```bash
railway variables set AGENT_WALLET_PRIVATE_KEY="0x..."
```

The agent will use this instead of generating a new one.

---

## Volume Persistence

### What Gets Saved

The persistent volume at `/data` stores:
- `wallet.json` - Encrypted wallet file
- Agent state and configuration
- Workspace files

### Volume Survives

- ✅ Deployments
- ✅ Restarts  
- ✅ Redeploys
- ✅ Code updates
- ❌ Service deletion (backup recommended)

---

## Alternative: Environment Variable Only

If you prefer not to use the volume (not recommended):

1. Generate wallet on first deployment
2. Export private key from logs or API
3. Set as environment variable:
   ```bash
   railway variables set AGENT_WALLET_PRIVATE_KEY="0x..."
   ```
4. Remove volume from `railway.toml`

**Note:** Volume + env var is the most robust approach:
- Volume handles normal persistence
- Env var is the backup/override mechanism

---

## Additional Resources

- **Railway API Docs**: https://docs.railway.app/reference/public-api
- **Railway CLI Docs**: https://docs.railway.app/develop/cli
- **Railway Tokens**: https://railway.app/account/tokens

---

**Questions?** Open an issue: https://github.com/buildonlabs-org/openclaw-agent/issues
