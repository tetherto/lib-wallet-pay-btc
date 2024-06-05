const BitcoinPay = require('../src/wallet-pay-btc.js')
const { WalletStoreHyperbee } = require('lib-wallet-store')
const KeyManager = require('../src/wallet-key-btc.js')
const BIP39Seed = require('wallet-seed-bip39')
const Electrum = require('../src/electrum.js')
const HdWallet = require('../src/hdwallet.js')
const { bitcoin } = require('../../wallet-test-tools/')
const BitcoinCurr = require('../src/currency')

async function newElectrum (config = {}) {
  config.host = 'localhost' || config.host
  config.port = '8001' || config.port
  config.store = config.store || newStore()
  let e
  try {
    e = new Electrum(config)
    await e.connect()
  } catch (err) {
    console.log('Error connecting to electrum', err)
  }
  return e
}

function newStore () {
  return new WalletStoreHyperbee()
}

let _regtest
async function regtestNode (opts = {}) {
  if (_regtest) return _regtest
  _regtest = new bitcoin.BitcoinCore({})
  await _regtest.init()
  if (!opts.mine) return _regtest
  await _regtest.mine({ blocks: 1 })
  return _regtest
}


async function activeWallet (config = {}) {
  const _store = newStore()
  let seed

  if (config.newWallet) {
    seed = await BIP39Seed.generate()
  } else {
    seed = await BIP39Seed.generate('sell clock better horn digital prevent image toward sort first voyage detail inner regular improve')
  }

  const store = config.store || _store

  const btcPay = new BitcoinPay({
    asset_name: 'btc',
    provider: await newElectrum({ store }),
    key_manager: new KeyManager({
      seed
    }),
    store,
    network: 'regtest'
  })

  await btcPay.initialize({})

  return btcPay
}

async function pause (ms) {
  console.log('Pausing.... ' + ms + 'ms')
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

module.exports = {
  BitcoinPay,
  WalletStore: WalletStoreHyperbee,
  KeyManager,
  BIP39Seed,
  Electrum,
  newElectrum,
  HdWallet,
  activeWallet,
  regtestNode,
  pause,
  BitcoinCurrency: BitcoinCurr.Bitcoin
}
