# lib-wallet-pay-btc

Bitcoin payment method for the wallet library. Powered by Electrum.


### Example

```javascript
// Start with a store engine
// 
const storeEngine = new WalletStoreMemory()
await storeEngine.init()

// Generate a seed or use a mnemonic phrase
const seed = await BIP39Seed.generate(/** Can enter mnemonic phrase here to **/)

// Connect to an electrum server
const provider = await Electrum({ store: storeEngine, host, port })
await provider.connect()

// Start new Bitcoin wallet
const btcPay = new BitcoinPay({
  // Asset name is a unique key for the asset, allow multiple assets of same type per wallet
  asset_name: 'btc',
  // Electrum provider. Store engine is required for for caching.
  provider,
  // Key manager: Handlles address generation from seed
  key_manager: new KeyManager({
    seed
  }),
  // Wallet store: Storage engine for the wallet
  store: storeEngine
  // Network: network type, regtest, testnet, mainnet
  network: 'regtest'
})

await btcPay.initialize({})

// Listen to each path that has transactions.
// This wallet follow BIP84 standard for address generation and the gap limit by default is 20.
btcPay.on('sync-path', (pathType, path, hasTx, progress) => {
  console.log('Syncing path', pathType, path, hasTx, progress)
})

// Parse blockchain for transactions to your wallet.
await btcPay.syncTransactions()

// Get a new address. This will add the address to watch list for incoming payments. You should limit address generation to prevent spam.
// This will return address, HD PATH, pubkey and WIF private key of the address. 
const { address } = await btcPay.getNewAddress()

// Get balance of an address
const addrBalance = await btcPay.getBalance({}, address)

// Get total balance accress all addresses
const walletBalance = await btcPay.getBalance({})

// Send bitcoin to an address
// Result will contain:
// - txid: Transaction ID
// - feeRate: Fee rate in sat/vByte
// - fee: Fee in satoshis
// - vSize: Virtual size of the transaction
// - hex: Raw transaction hex
// - utxo: UTXO used in the transaction
// - vout: Vout bytes of the transaction
// - changeAddress: Change address of the transaction. which contains, address, WIF, path, pub key.
const result = await btcPay.sendTransaction({}, {)
  to: // bitcoin address of the recipient
  
  // Amounts of bitcoin to send 
  amount: 0.0001, // Value of amount 
  unit: 'main', // unit of amount: main = Bitcoin and base = satoshi unit

  fee: 10, // Fees in sats per vbyte. 10 = 10 sat/vByte
}))

// Get a transaction by txid
const tx = await btcPay.getTransaction(result.txid)

// Get a list of transactions
const txs = await btcPay.getTransactions(query)


```

## Testing
- There is extensive integration tests for this package. 
- We use Brittle for testing. Checkout package.json for various test commands.
- Integration tests need a electrum server connected to a regtest bitcoin node. 

