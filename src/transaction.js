const bitcoin = require('bitcoinjs-lib')
const { EventEmitter } = require('events')
const Bitcoin = require('./currency.js')

const DUST_LIMIT = 546

class Transaction extends EventEmitter {
  constructor (config) {
    super()

    this._max_fee_limit = 100000 || config.max_fee_limit
    this.network = config.network
    this.provider = config.provider
    this.keyManager = config.keyManager
    this._getInternalAddress = config.getInternalAddress
    this._syncManager = config.syncManager
  }

  async send (opts) {
    const tx = await this._createTransaction(opts)
    const txid = await this._broadcastTransaction(tx)
    if (txid?.message) {
      this._syncManager.unlockUtxo(false)
      throw new Error('Broadcast failed: ' + txid.message.split('\n').shift())
    }
    this._syncManager.unlockUtxo(true)
    return tx
  }

  async _broadcastTransaction (tx) {
    return this.provider.broadcastTransaction(tx.hex)
  }

  async _generateRawTx (utxoSet, fee, sendAmount, address, changeAddr, weight = 1) {
    if (+sendAmount.toBaseUnit() <= DUST_LIMIT) throw new Error('send amount must be bigger than dust limit ' + DUST_LIMIT + ' got: ' + sendAmount.toBaseUnit())
    const { keyManager, network } = this
    const { utxo, total } = utxoSet
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks[network] })

    utxo.forEach((utxo, index) => {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.index,
        witnessUtxo: {
          script: Buffer.from(utxo.witness_hex, 'hex'),
          value: +utxo.value.toBaseUnit()
        }
      })

      psbt.updateInput(index, {
        bip32Derivation: [
          {
            masterFingerprint: keyManager.bip32.fingerprint,
            path: utxo.address_path,
            pubkey: Buffer.from(utxo.address_public_key, 'hex')
          }
        ]
      })
    })

    const totalFee = Bitcoin.BN(fee).times(weight)
    const change = Bitcoin.BN(total.toBaseUnit()).minus(sendAmount.toBaseUnit()).minus(totalFee).toNumber()

    if (change < DUST_LIMIT) {
      // Current UTXO set is not enought to pay for amount + fee. we need to get more UTXO.
      // If there is no more UTXO. this will throw error
      await this._syncManager.unlockUtxo(false)
      const newAmount = total.add(new Bitcoin(fee, 'base'))
      const newUtxoSet = await this._syncManager.utxoForAmount(newAmount)
      return await this._generateRawTx(newUtxoSet, fee, sendAmount, address, changeAddr, weight)
    }

    psbt.addOutput({
      address,
      value: +sendAmount.toBaseUnit()
    })

    if (change !== 0) {
      psbt.addOutput({
        address: changeAddr.address,
        value: change
      })
    }

    utxo.forEach((u, index) => {
      psbt.signInputHD(index, keyManager.bip32)
    })
    psbt.finalizeAllInputs()
    const tx = psbt.extractTransaction()
    return {
      sendAddress: address,
      feeRate: psbt.getFeeRate(),
      totalFee: totalFee.toNumber(),
      totalSpent: totalFee.plus(sendAmount.toBaseUnit()).toNumber(),
      vSize: tx.virtualSize(),
      hex: tx.toHex(),
      txid: tx.getId(),
      utxo,
      vout: tx.outs
    }
  }

  async _createTransaction ({ address, amount, unit, fee }) {
    if (!fee || fee <= 0 || fee > this._max_fee_limit) throw new Error('Invalid fee ' + fee)

    const changeAddr = await this._getInternalAddress()
    const sendAmount = new Bitcoin(amount, unit)
    const utxoSet = await this._syncManager.utxoForAmount({ amount, unit })

    // Generate a fake transaction to determine weight of the transaction
    // then we create a new tx with correct fee
    const fakeTx = await this._generateRawTx(utxoSet, fee, sendAmount, address, changeAddr)
    const realTx = await this._generateRawTx(utxoSet, fee, sendAmount, address, changeAddr, fakeTx.vSize)
    realTx.changeAddress = changeAddr
    await this._syncManager.addSentTx(realTx)
    return realTx
  }
}

module.exports = Transaction
