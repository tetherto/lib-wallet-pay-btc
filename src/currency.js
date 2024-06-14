const { Currency } = require('lib-wallet')

const BN = Currency.BN

class Bitcoin extends Currency {

  constructor(){ 
    super(...arguments)
    const { amount, type, config } = this._parseConstArg(arguments)
    this.name = 'BTC'
    this.base_name = 'SATS'
    this.decimal_places = 8
  }

  toBaseUnit() {
    if(this.type === "base") return this.amount.toString()
    return Bitcoin.toBaseUnit(this.amount, this.decimal_places)
  }

  toMainUnit() {
    if(this.type === "main") return this.amount.toString()
    return Bitcoin.toMainUnit(this.amount, this.decimal_places)
  }

  static toBaseUnit(amount, decimal) {
    return BN(amount).shiftedBy(decimal).toString()
  }

  static toMainUnit(amount, decimal) {
    return BN(amount).shiftedBy(decimal * -1).dp(decimal).toString()
  }

  toString() {
    return this.amount.toString()
  }

  toNumber() {
    return +this.amount
  }

  isBitcoin(btc) {
    if(!(btc instanceof Bitcoin)) throw new Error("Amount must be an instance of Bitcoin")
  }

  abs() {
    this.amount = Math.abs(this.amount)
    return this
  }
  
  minus(amount) {
    this.isBitcoin(amount)
    let thisBase = this.toBaseUnit()
    let amountBase = amount.toBaseUnit()
    let total = new BN(thisBase).minus(amountBase)
    return new Bitcoin(total, 'base', this.config)
  }

  add(amount) {
    this.isBitcoin(amount)
    let thisBase = this.toBaseUnit()
    let amountBase = amount.toBaseUnit()
    let total = new BN(thisBase).plus(amountBase)
    return new Bitcoin(total, 'base', this.config)
  }

  lte(amount) {
    this.isBitcoin(amount)
    let thisBase = this.toBaseUnit()
    let amountBase = amount.toBaseUnit()
    return new BN(thisBase).lte(amountBase)
  }

  eq(amount) {
    this.isBitcoin(amount)
    let thisBase = this.toBaseUnit()
    let amountBase = amount.toBaseUnit()
    return new BN(thisBase).eq(amountBase)
  }

  gte(amount) {
    this.isBitcoin(amount)
    let thisBase = this.toBaseUnit()
    let amountBase = amount.toBaseUnit()
    return new BN(thisBase).gte(amountBase)
  }

  bn(unit) {
    if(unit === 'base') return new BN(this.toBaseUnit())
    return new BN(this.toMainUnit())
  }
}

module.exports = Bitcoin
