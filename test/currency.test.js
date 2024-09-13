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
const test = require('brittle')
const Btc = require('../src/currency.js')

test('Currency: Bitcoin', async (t) => {
  test('Units', async (t) => {
    const btc = new Btc(1, 'main')
    t.ok(btc.name === 'BTC', 'currency name is BTC')
    t.ok(btc.base_name === 'SATS', 'currency name is SATS')

    const base = btc.toBaseUnit()
    t.ok(+base === 100000000, 'toBaseUnit is correct')
    t.ok(+btc.toMainUnit(base) === 1, 'toMainUnit is correct')
  })

  test('isUnitOf', async (t) => {
    const btc = new Btc(1, 'main')
    try {
      btc.isUnitOf('SATS')
    } catch (err) {
      t.ok(err.message === 'Amount must be an instance of Bitcoin', 'isUnitOf is implemented')
    }
  })

  test('Math: add', async (t) => {
    const btc = new Btc(1, 'main')
    const btc2 = btc.add(btc)

    t.ok(+btc2.toMainUnit() === 2, 'add: 1+1=2')

    const btc3 = btc2.add(new Btc(100000001, 'base'))
    t.ok(+btc3.toMainUnit() === 3.00000001, 'add: 2 + 1.00000001 = 3.00000001')
  })

  test('Math: minus', async (t) => {
    const btc = new Btc(2, 'main')
    const btc2 = btc.minus(btc)

    t.ok(+btc2.toMainUnit() === 0, 'add: 2-2=0')

    const btc3 = btc.minus(new Btc(100000001, 'base'))
    t.ok(+btc3.toMainUnit() === 0.99999999, 'minus: 2-1.00000001 = 0.99999999')
  })

  test('Math: lte', async (t) => {
    const btc2 = new Btc(2, 'main')
    const btc1 = new Btc(1, 'main')
    t.ok(btc1.lte(btc2), '1 <= 2')
  })

  test('Math: gte', async (t) => {
    const btc2 = new Btc(2, 'main')
    const btc1 = new Btc(1, 'main')
    t.ok(btc2.gte(btc1), '2 >= 1')
  })

  test('Math: gte', async (t) => {
    const btc2 = new Btc(2, 'main')
    const btc1 = new Btc(2, 'main')
    t.ok(btc2.eq(btc1), '2 == 2')
    t.ok(btc2.eq(new Btc(3, 'main')) === false, ' 2 != 3')
  })
})
