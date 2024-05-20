const { EventEmitter } = require('events')
const WalletPay = require('../../wallet-pay/src/wallet-pay.js')
const Transaction = require('./transaction.js')
const HdWallet = require('./hdwallet.js')
const { SyncManager, UTXOManager } = require('./sync-manager.js')

const WalletPayError = Error

class StateDb {
  constructor(config) {
    this.store = config.store
  }

  async init() {
    await this.store.init()
  }

  async updateReceiveBalance(balance) {
    return this.store.put('receive_balance', balance)
  }

  async getSyncState(opts) {
    const state = await this.store.get('sync_state')
    if(!state || opts?.restart) {
      return {
        internal: { path : null, gap: 0, gapEnd: null },
        external: { path : null, gap: 0 , gapEnd: null}
      }
    }
    return state
  }

  resetSyncState() {
    const state = {
      internal: { path : null, gap: 0, gapEnd: null },
      external: { path : null, gap: 0 , gapEnd: null}
    }
    this.store.put('sync_state', state)
    return state
  }

  async setSyncState(state) {
    return this.store.put('sync_state', state)
  }
}


class WalletPayBitcoin extends WalletPay {

  static networks = ['regtest', 'mainnet', 'testnet', 'signet', 'bitcoin']
  
  constructor(config) {
    super(config)
    if(!config.network) throw new WalletPayError('Network is required')

    this.network = config.network
    if(!WalletPayBitcoin.networks.includes(this.network)) throw new WalletPayError('Invalid network')

    this.state = new StateDb({
      store: this.store.newInstance({ name : 'state'})
    })

    this._hdWallet = new HdWallet({ store: this.store.newInstance({ name : 'hdwallet'}) })
    this.provider = config.provider
    this.keyManager.setNetwork(this.network)
    this.gapLimit = config.gapLimit || 20
    this.min_block_confirm = config.min_block_confirm || 1
    this.latest_block = 0
    this._utxoManager = new UTXOManager({ store: this.store.newInstance({ name : 'utxomanager'}) })

    this._syncManager = new SyncManager({
      state: this.state,
      gapLimit: this.gapLimit,
      hdWallet : this._hdWallet,
      utxoManager: this._utxoManager,
      provider: this.provider,
      keyManager: this.keyManager,
      currentBlock: this.latest_block,
      minBlockConfirm: this.min_block_confirm,
    })
  }

  async destroy() {
    await this.provider.close()
  }

  async initialize(wallet) {
    if(this.ready) return Promise.resolve()

    super.initialize(wallet)

    await this.state.init()
    await this._hdWallet.init()
    await this._utxoManager.init()
    const electrum = new Promise((resolve, reject) => {
      // @note: Blocks may be skipped. 
      // TODO: handle reorgs
      this.provider.on('new-block', (block) => {
        this.latest_block = block.height
        this._syncManager.updateBlock(this.latest_block)
        this.ready = true
        this.emit('ready')
        resolve()
      })
    })
    await this.provider.subscribeToBlocks()

    this._syncManager.on('synced-path', (...args)=>{
      this.emit('synced-path', ...args)
    })
    return Promise.resolve(electrum)
  }


  static parsePath(path) {
    return HdWallet.parsePath(path)
  }

  async getNewAddress(config = {}) { 
    let path =  this._hdWallet.getLastExtPath() 
    const addrType = HdWallet.getAddressType(path)
    const addr = this.keyManager.addrFromPath(path, addrType)
    this.emit('new-address', addr)
    path = HdWallet.bumpIndex(path)
    this._hdWallet.updateLastPath(path)
    return addr
  }

  async _getInternalAddress() {
    let path =  this._hdWallet.getLastIntPath() 
    const addrType = HdWallet.getAddressType(path)
    const addr = this.keyManager.addrFromPath(path, addrType)

    path = HdWallet.bumpInternalIndex(path)
    this._hdWallet.updateLastPath(path)
    this.emit('new-address', this.latest_addr)
    return addr
  }

  getBalance(opts, addr) {
    return this._syncManager.getBalance(addr)
  }

  /**
  * Sync transactions
  * @param {Object} opts - Options
  * @param {Number} opts.restart - Restart sync from 0 
  */ 
  syncTransactions(opts = {}) {
    return new Promise( async (resolve, reject) => {
      await this._syncManager.ready()
      if(opts?.reset) {
        await this._syncManager.reset()
      }

      await this._syncManager.syncAccount('external', opts)
      if(this._syncManager.isStopped()) {
        this._syncManager.resumeSync()
        this.emit('sync-end')
        return resolve()
      }
      await this._syncManager.syncAccount('internal', opts)
      this._syncManager.resumeSync()
      this.emit('sync-end')
      resolve()
    })
  }

  async pauseSync() {
    return new Promise((resolve) => {
      if(!this._syncManager) throw new WalletPayError('Not syncing')
      this.once('sync-end', () => resolve())
      this._syncManager.stopSync()
    })
  }

  async sendTransaction(opts, outgoing) {

    const tx = new Transaction({
      network: this.network,
      provider: this.provider,
      keyManager: this.keyManager,
      getInternalAddress: this._getInternalAddress.bind(this),
      syncManager: this._syncManager
    })
    let res
    try {
      res = await tx.send(outgoing)
    } catch(err) {
      throw err
    }

    // TODO: Update utxo manager
    // TODO  sync when it is confirmed 

    return res
  }

  isValidAddress(address) {
    return this._makeRequest('blockchain.address.get_balance', [address])
  }

}

module.exports = WalletPayBitcoin
