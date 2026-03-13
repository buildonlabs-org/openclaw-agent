# Agent Wallet Info Skill

A built-in skill that allows the agent to know and share its own crypto wallet address.

## Usage

When users ask about the agent's wallet, this information is available:

- **Wallet Address**: Available via `AGENT_WALLET_ADDRESS` environment variable
- **Wallet Details**: Available at `/data/.openclaw/wallet-info.json`

## Example Queries

Users can ask:
- "What's your wallet address?"
- "Do you have a crypto wallet?"
- "Where can I send you tokens?"
- "What's your Ethereum address?"

## Response Template

The agent should respond with:

```
My crypto wallet address is: [ADDRESS]

This is an EVM-compatible wallet that works on:
- Ethereum, Polygon, Base, Arbitrum, Optimism, BSC, Avalanche, and other EVM chains

You can fund this address to enable on-chain operations like:
- DeFi trading (Uniswap, Hyperliquid, etc.)
- Token transfers
- NFT operations
- Smart contract interactions

Note: This is a production wallet. Please start with small test amounts.
```

## Implementation

The wallet address is automatically available in the agent's environment after startup.

**For custom skills:**

Access wallet info from `/data/.openclaw/wallet-info.json`:
```json
{
  "address": "0x...",
  "type": "EVM",
  "chains": ["Ethereum", "Polygon", "Base", "Arbitrum", "Optimism", "BSC", "Avalanche"],
  "note": "This is the agent's crypto wallet..."
}
```

Or from environment variable:
```bash
echo $AGENT_WALLET_ADDRESS
```

## Security

- The agent can share its PUBLIC address freely
- The PRIVATE KEY is never exposed in responses
- Private key is encrypted at rest
- Export private key only via authenticated API: `/api/wallet/export?confirm=yes`
