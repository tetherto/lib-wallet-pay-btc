
const { BIP32Factory } = require('bip32')
const ecc = require('tiny-secp256k1')
const bip32 = BIP32Factory(ecc)
const bitcoin = require('bitcoinjs-lib')

// TODO:
// [] unit tests

class WalletKeyBitcoin {

  constructor(config) {
    this.seed = config.seed
    this.bip32 = bip32.fromSeed(this.seed.seed, bitcoin.networks.bitcoin)
    //this.bip32 = bip32.fromBase58(bip32.fromSeed(this.seed.seed).neutered().toBase58(), this.network)
  }

  setNetwork(network) {
    if(network === 'mainnet') network = 'bitcoin'
    this.network = bitcoin.networks[network]
  }

  /**
  * @param {string} path - BIP32 path
  * @param {string} addrType - Address type. example: p2wkh
  * @returns {string} - Address
  * @desc Derives a bitcoin address from a BIP32 path
  */
  addrFromPath(path, addrType) {
    const node = this.bip32.derivePath(path)
    let address =  bitcoin.payments[addrType]({ pubkey: node.publicKey, network: this.network }).address;
    return {
      address,
      publicKey: node.publicKey.toString('hex'),
      WIF: node.toWIF(),
      path
    }
  }
  addressToScriptHash(addr) {
    const script = bitcoin.address.toOutputScript(addr, this.network)
    const hash = bitcoin.crypto.sha256(script)
    const reversedHash = Buffer.from(hash.reverse())
    return reversedHash.toString('hex')
  }

  pathToScriptHash(path, addrType) {
    const addr = this.addrFromPath(path, addrType)
    const hash =  this.addressToScriptHash(addr.address)
    return [hash , addr]
  }

}

module.exports = WalletKeyBitcoin
