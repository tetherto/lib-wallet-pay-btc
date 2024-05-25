# lib-wallet-pay-btc

Bitcoin payment method for the wallet library. Powered by Electrum.


### Example

```javascript
// Start with a storage engine
// 
const storeEngine = new WalletStoreMemory()
await storeEngine.init()

// Generate a seed or use a mnemonic phrase
const seed = await BIP39Seed.generate(/** Can enter mnemonic phrase here to **/)

// Connect to an electrum server.
// This class needs a storage engine for cacheing.
// host and port are the electrum server details.
// Additional options can be passed to the Electrum class with regards to caching.
const provider = await Electrum({ store: storeEngine, host, port })
await provider.connect()

// Start new Bitcoin wallet
const btcPay = new BitcoinPay({
  // Asset name is a unique key for the asset, allow multiple assets of same type per wallet
  asset_name: 'btc',
  // Electrum provider.
  provider,
  // Key manager: Handlles address generation library from seed.
  key_manager: new KeyManager({
    seed
  }),
  // Wallet store: Storage engine for the wallet
  store: storeEngine
  // Network: network type, regtest, testnet, mainnet
  network: 'regtest',
  // Min confs: Minimum number of confirmations to consider a transaction confirmed
  min_block_confirmations: 1,
  // Gap limit: Number of addresses to look ahead for transactions.
  gap_limit: 20,
})
// Start wallet.
await btcPay.initialize({})

// Listen to each path that has transactions.
// This wallet follow BIP84 standard for address generation and the gap limit by default is 20.
btcPay.on('sync-path', (pathType, path, hasTx, progress) => {
  console.log('Syncing path', pathType, path, hasTx, progress)
})

// Parse blockchain for transactions to your wallet.
// This needs to be run when recreating a wallet. 
// This can take long depending on the number of addresses a wallet has created.
await btcPay.syncTransactions({ 
  reset : false // Passing true will resync from scratch 
})


// Pause the sync process. 
// If the application needs to sleep and come back to resume syncing.
await btcPay.pauseSync()


// Get a new address. This will add the address to watch list for incoming payments. You should limit address generation to prevent spam.
// This will return address, HD PATH, pubkey and WIF private key of the address. 
const { address } = await btcPay.getNewAddress()

// Get balance of an address
// Balance is returned in format of:
// Confirmed: Confirmed balance. This is transactions that have more than min number of confirmations 
// Pending: Pending balance. Transactions that have less than min number of confirmations
// Mempool: Mempool balance. Transactions that are in the mempool and have no confirmations.
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
const result = await btcPay.sendTransaction({}, {
  to: 'bcr111...', // bitcoin address of the recipient
  
  // Amounts of bitcoin to send 
  amount: 0.0001, // Value of amount 
  unit: 'main', // unit of amount: main = Bitcoin and base = satoshi unit

  fee: 10, // Fees in sats per vbyte. 10 = 10 sat/vByte
}))

// Get a transaction by txid
const tx = await btcPay.getTransaction(result.txid)

// Get a list of transactions
const txs = await btcPay.getTransactions(query)

// is address a valid bitcoin address
const isvalid = await btcPay.isValidAddress('bcrt1qxeyapzy3ylv67qnxjtwx8npd8ypjkuy8xstu0m')

// Destroy instance of the wallet. This stops all wallet activity.
// You need to recreate btcPay instance to use the wallet again.
await btcPay.destroy()


### TODO:
[] Fee estimation. 
[] Transaction history query 
[] Handle block reorg
[] Additional tests for: transaction creation and balance checking. 

```

## Testing
- There is extensive integration tests for this package. 
- We use Brittle for testing. Checkout package.json for various test commands.
- Integration tests need a electrum server connected to a regtest bitcoin node. 

