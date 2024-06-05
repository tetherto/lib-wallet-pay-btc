const { BIP32Factory } = require('bip32')
const ecc = require('tiny-secp256k1')
const bip32 = BIP32Factory(ecc)
const bitcoin = require('bitcoinjs-lib')

// TODO:
// [] unit tests

class WalletKeyBitcoin {
  constructor (config = {}) {
    if(config.seed) {
      this.seed = config.seed
      this.bip32 = bip32.fromSeed(this.seed.seed, bitcoin.networks.bitcoin)
      this.ready = true
    } else {
      this.ready = false
    }
    
    if (config.network === 'mainnet') config.network = 'bitcoin'
    this.network = bitcoin.networks[config.network]
  }
  
  // Custom inspect method
  close() {
    this.seed = null 
    this.bip32 = null
  }

  setSeed(seed) {
    if(this.seed) throw new Error('Seed already set')
    if(!this.network) throw new Error('Network not set')
    if(!seed) throw new Error('Seed is required')
    this.seed = seed
    this.bip32 = bip32.fromSeed(this.seed.seed, this.network)
    this.ready = true
  }

  /**
  * @param {string} path - BIP32 path
  * @param {string} addrType - Address type. example: p2wkh
  * @returns {string} - Address
  * @desc Derives a bitcoin address from a BIP32 path
  */
  addrFromPath (path, addrType) {
    const node = this.bip32.derivePath(path)
    const address = bitcoin.payments[addrType]({ pubkey: node.publicKey, network: this.network }).address
    return {
      address,
      publicKey: node.publicKey.toString('hex'),
      WIF: node.toWIF(),
      path
    }
  }

  addressToScriptHash (addr) {
    const script = bitcoin.address.toOutputScript(addr, this.network)
    const hash = bitcoin.crypto.sha256(script)
    const reversedHash = Buffer.from(hash.reverse())
    return reversedHash.toString('hex')
  }

  pathToScriptHash (path, addrType) {
    const addr = this.addrFromPath(path, addrType)
    const hash = this.addressToScriptHash(addr.address)
    return [hash, addr]
  }
}

module.exports = WalletKeyBitcoin
