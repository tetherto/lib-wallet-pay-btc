// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'
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
    let txid
    try {
      txid = await this._broadcastTransaction(tx)
    } catch(err) {
      console.log(err)
      throw new Error('failed to broadcast tx')
    }
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
    let fakeTx, realTx

    try {
      fakeTx = await this._generateRawTx(utxoSet, fee, sendAmount, address, changeAddr)
    } catch(err) {
      throw new Error('Failed to simulate tx: '+ err.message)
    }

    try { 
      realTx = await this._generateRawTx(utxoSet, fee, sendAmount, address, changeAddr, fakeTx.vSize)
    } catch(err) {
      throw new Error('failed to send transaction'+ err.message)
    }

    realTx.changeAddress = changeAddr
    await this._syncManager.addSentTx(realTx)
    return realTx
  }
}

module.exports = Transaction
