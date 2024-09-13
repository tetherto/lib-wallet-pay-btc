'use strict'
const { Currency } = require('lib-wallet')

const BN = Currency._BN

class Bitcoin extends Currency {
  constructor () {
    super(...arguments)
    this._parseConstArg(arguments)
    this.name = 'BTC'
    this.base_name = 'SATS'
    this.decimal_places = 8
  }

  toBaseUnit () {
    if (this.type === 'base') return this.amount.toString()
    return Bitcoin.toBaseUnit(this.amount, this.decimal_places)
  }

  toMainUnit () {
    if (this.type === 'main') return this.amount.toString()
    return Bitcoin.toMainUnit(this.amount, this.decimal_places)
  }

  isBitcoin (amount) {
    return this.isUnitOf(amount)
  }

  isUnitOf (btc) {
    if (!(btc instanceof Bitcoin)) throw new Error('Amount must be an instance of Bitcoin')
  }

  bn (unit) {
    if (unit === 'base') return new BN(this.toBaseUnit())
    return new BN(this.toMainUnit())
  }
}

module.exports = Bitcoin
