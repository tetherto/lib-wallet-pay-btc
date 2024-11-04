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

const { test, solo } = require('brittle')
const { Balance }  = require('../src/address-manager')
const Bitcoin = require('../src/currency')

test('Balance - constructor initializes correctly', (t) => {
  const balance = new Balance(100, 50, 25)
  
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should be 100')
  t.ok(balance.pending.toMainUnit() === '50', 'Pending balance should be 50')
  t.ok(balance.mempool.toMainUnit() === '25', 'Mempool balance should be 25')
  t.ok(JSON.stringify(balance.txid) === JSON.stringify({
    confirmed: [],
    pending: [],
    mempool: []
  }), 'txid should be initialized correctly')
})

test('Balance - addTxid adds transaction correctly', (t) => {
  const balance = new Balance()
  balance.addTxid('confirmed', 'tx1', new Bitcoin(100, 'main'))
  
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should be 100')
  t.ok(JSON.stringify(balance.txid.confirmed) === JSON.stringify([['tx1', new Bitcoin(100, 'main')]]), 
       'Transaction should be added to confirmed list')
})

test('Balance - addTxid moves transaction between states', (t) => {
  const balance = new Balance()
  balance.addTxid('mempool', 'tx1', new Bitcoin(100, 'main'))
  balance.addTxid('confirmed', 'tx1', new Bitcoin(100, 'main'))
  
  t.ok(balance.mempool.toMainUnit() === '0', 'Mempool balance should be 0')
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should be 100')
  t.ok(balance.txid.mempool.length === 0, 'Mempool txid list should be empty')
  t.ok(JSON.stringify(balance.txid.confirmed) === JSON.stringify([['tx1', new Bitcoin(100, 'main')]]), 
       'Transaction should be moved to confirmed list')
})

test('Balance - getTx retrieves correct transaction', (t) => {
  const balance = new Balance()
  balance.addTxid('confirmed', 'tx1', new Bitcoin(100, 'main'))
  
  const tx = balance.getTx('confirmed', 'tx1')
  t.ok(JSON.stringify(tx) === JSON.stringify(['tx1', new Bitcoin(100, 'main')]), 
       'getTx should return the correct transaction')
})

test('Balance - combine calculates difference correctly', (t) => {
  const balance1 = new Balance(100, 50, 25)
  const balance2 = new Balance(50, 25, 10)
  
  const combined = balance1.combine(balance2)
  
  t.ok(combined.confirmed.toMainUnit() === '50', 'Combined confirmed balance should be 50')
  t.ok(combined.pending.toMainUnit() === '25', 'Combined pending balance should be 25')
  t.ok(combined.mempool.toMainUnit() === '15', 'Combined mempool balance should be 15')
  t.ok(combined.consolidated.toMainUnit() === '90', 'Combined consolidated balance should be 90')
})

test('Balance - formatted returns correct object', (t) => {
  const balance = new Balance(100, 50, 25)
  
  const formatted = balance.formatted()
  
  t.ok(formatted.confirmed.toMainUnit() === '100', 'Formatted confirmed balance should be 100')
  t.ok(formatted.pending.toMainUnit() === '50', 'Formatted pending balance should be 50')
  t.ok(formatted.mempool.toMainUnit() === '25', 'Formatted mempool balance should be 25')
  t.ok(formatted.consolidated.toMainUnit() === '175', 'Formatted consolidated balance should be 175')
})

test('Balance - addTxid correctly adjusts balance when moving from mempool to pending', (t) => {
  const balance = new Balance(0, 0, 0)
  balance.addTxid('mempool', 'tx1', new Bitcoin(100, 'main'))
  
  t.ok(balance.mempool.toMainUnit() === '100', 'Initial mempool balance should be 100')
  
  balance.addTxid('pending', 'tx1', new Bitcoin(100, 'main'))
  
  t.ok(balance.mempool.toMainUnit() === '0', 'Mempool balance should be reduced to 0')
  t.ok(balance.pending.toMainUnit() === '100', 'Pending balance should be increased to 100')
  t.ok(balance.txid.mempool.length === 0, 'Mempool txid list should be empty')
  t.ok(JSON.stringify(balance.txid.pending) === JSON.stringify([['tx1', new Bitcoin(100, 'main')]]), 
       'Transaction should be moved to pending list')
})

test('Balance - addTxid correctly adjusts balance when moving from pending to confirmed', (t) => {
  const balance = new Balance(0, 0, 0)
  balance.addTxid('pending', 'tx1', new Bitcoin(100, 'main'))
  
  t.ok(balance.pending.toMainUnit() === '100', 'Initial pending balance should be 100')
  
  balance.addTxid('confirmed', 'tx1', new Bitcoin(100, 'main'))
  
  t.ok(balance.pending.toMainUnit() === '0', 'Pending balance should be reduced to 0')
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should be increased to 100')
  t.ok(balance.txid.pending.length === 0, 'Pending txid list should be empty')
  t.ok(JSON.stringify(balance.txid.confirmed) === JSON.stringify([['tx1', new Bitcoin(100, 'main')]]), 
       'Transaction should be moved to confirmed list')
})

test('Balance - addTxid correctly adjusts balance when changing transaction amount', (t) => {
  const balance = new Balance(0, 0, 0)
  balance.addTxid('confirmed', 'tx1', new Bitcoin(100, 'main'))
  
  t.ok(balance.confirmed.toMainUnit() === '100', 'Initial confirmed balance should be 100')
  
  balance.addTxid('confirmed', 'tx1', new Bitcoin(150, 'main'))
  
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should be updated to 100')
  t.ok(JSON.stringify(balance.txid.confirmed) === JSON.stringify([['tx1', new Bitcoin(150, 'main')]]), 
       'Transaction amount should be updated in the confirmed list')
})

test('Balance - addTxid correctly handles multiple transactions in different states', (t) => {
  const balance = new Balance()
  
  balance.addTxid('mempool', 'tx1', new Bitcoin(50, 'main'))
  balance.addTxid('pending', 'tx2', new Bitcoin(75, 'main'))
  balance.addTxid('confirmed', 'tx3', new Bitcoin(100, 'main'))
  
  t.ok(balance.mempool.toMainUnit() === '50', 'Mempool balance should be 50')
  t.ok(balance.pending.toMainUnit() === '75', 'Pending balance should be 75')
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should be 100')
  
  balance.addTxid('confirmed', 'tx1', new Bitcoin(50, 'main'))
  balance.addTxid('confirmed', 'tx2', new Bitcoin(75, 'main'))
  
  t.ok(balance.mempool.toMainUnit() === '0', 'Mempool balance should be reduced to 0')
  t.ok(balance.pending.toMainUnit() === '0', 'Pending balance should be reduced to 0')
  t.ok(balance.confirmed.toMainUnit() === '225', 'Confirmed balance should be increased to 225')
  t.ok(balance.txid.mempool.length === 0, 'Mempool txid list should be empty')
  t.ok(balance.txid.pending.length === 0, 'Pending txid list should be empty')
  t.ok(balance.txid.confirmed.length === 3, 'Confirmed txid list should have 3 transactions')
})


test('Balance - addTxid handles multiple transactions and updates balances correctly', (t) => {
  const balance = new Balance()
  
  // Add transactions to different states
  balance.addTxid('mempool', 'tx1', new Bitcoin(25, 'main'))
  balance.addTxid('pending', 'tx2', new Bitcoin(50, 'main'))
  balance.addTxid('confirmed', 'tx3', new Bitcoin(100, 'main'))
  
  // Check initial balances
  t.ok(balance.mempool.toMainUnit() === '25', 'Mempool balance should be 25')
  t.ok(balance.pending.toMainUnit() === '50', 'Pending balance should be 50')
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should be 100')
  
  // Move transaction from mempool to pending
  balance.addTxid('pending', 'tx1', new Bitcoin(25, 'main'))
  
  t.ok(balance.mempool.toMainUnit() === '0', 'Mempool balance should be reduced to 0')
  t.ok(balance.pending.toMainUnit() === '75', 'Pending balance should be increased to 75')
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should remain 100')
  
  // Move transactions to confirmed
  balance.addTxid('confirmed', 'tx1', new Bitcoin(25, 'main'))
  balance.addTxid('confirmed', 'tx2', new Bitcoin(50, 'main'))
  
  t.ok(balance.mempool.toMainUnit() === '0', 'Mempool balance should remain 0')
  t.ok(balance.pending.toMainUnit() === '0', 'Pending balance should be reduced to 0')
  t.ok(balance.confirmed.toMainUnit() === '175', 'Confirmed balance should be increased to 175')
  
  // Check final state of txid lists
  t.ok(balance.txid.mempool.length === 0, 'Mempool txid list should be empty')
  t.ok(balance.txid.pending.length === 0, 'Pending txid list should be empty')
  t.ok(balance.txid.confirmed.length === 3, 'Confirmed txid list should have 3 transactions')
})

// Test to ensure addTxid doesn't decrease balances
test('Balance - addTxid never decreases balances', (t) => {
  const balance = new Balance()
  
  balance.addTxid('confirmed', 'tx1', new Bitcoin(100, 'main'))
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should be 100')
  
  // Attempt to decrease balance (which should not work)
  balance.addTxid('confirmed', 'tx1', new Bitcoin(50, 'main'))
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should still be 100')
  
  // Add a new transaction
  balance.addTxid('confirmed', 'tx2', new Bitcoin(75, 'main'))
  t.ok(balance.confirmed.toMainUnit() === '175', 'Confirmed balance should increase to 175')
})

test('Balance - moving transaction from mempool to pending', (t) => {
  const balance = new Balance()
  const txAmount = new Bitcoin(50, 'main')
  
  balance.addTxid('mempool', 'tx1', txAmount)
  t.ok(balance.mempool.toMainUnit() === '50', 'Initial mempool balance should be 50')
  t.ok(balance.pending.toMainUnit() === '0', 'Initial pending balance should be 0')
  
  balance.addTxid('pending', 'tx1', txAmount)
  t.ok(balance.mempool.toMainUnit() === '0', 'Mempool balance should be reduced to 0')
  t.ok(balance.pending.toMainUnit() === '50', 'Pending balance should be increased to 50')
  t.ok(balance.txid.mempool.length === 0, 'Mempool txid list should be empty')
  t.ok(balance.txid.pending.length === 1, 'Pending txid list should have 1 transaction')
})

test('Balance - moving transaction from pending to confirmed', (t) => {
  const balance = new Balance()
  const txAmount = new Bitcoin(75, 'main')
  
  balance.addTxid('pending', 'tx1', txAmount)
  t.ok(balance.pending.toMainUnit() === '75', 'Initial pending balance should be 75')
  t.ok(balance.confirmed.toMainUnit() === '0', 'Initial confirmed balance should be 0')
  
  balance.addTxid('confirmed', 'tx1', txAmount)
  t.ok(balance.pending.toMainUnit() === '0', 'Pending balance should be reduced to 0')
  t.ok(balance.confirmed.toMainUnit() === '75', 'Confirmed balance should be increased to 75')
  t.ok(balance.txid.pending.length === 0, 'Pending txid list should be empty')
  t.ok(balance.txid.confirmed.length === 1, 'Confirmed txid list should have 1 transaction')
})

test('Balance - moving transaction directly from mempool to confirmed', (t) => {
  const balance = new Balance()
  const txAmount = new Bitcoin(100, 'main')
  
  balance.addTxid('mempool', 'tx1', txAmount)
  t.ok(balance.mempool.toMainUnit() === '100', 'Initial mempool balance should be 100')
  t.ok(balance.confirmed.toMainUnit() === '0', 'Initial confirmed balance should be 0')
  
  balance.addTxid('confirmed', 'tx1', txAmount)
  t.ok(balance.mempool.toMainUnit() === '0', 'Mempool balance should be reduced to 0')
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should be increased to 100')
  t.ok(balance.txid.mempool.length === 0, 'Mempool txid list should be empty')
  t.ok(balance.txid.confirmed.length === 1, 'Confirmed txid list should have 1 transaction')
})

test('Balance - moving multiple transactions between states', (t) => {
  const balance = new Balance()
  const tx1Amount = new Bitcoin(30, 'main')
  const tx2Amount = new Bitcoin(70, 'main')
  
  balance.addTxid('mempool', 'tx1', tx1Amount)
  balance.addTxid('mempool', 'tx2', tx2Amount)
  t.ok(balance.mempool.toMainUnit() === '100', 'Initial mempool balance should be 100')
  
  balance.addTxid('pending', 'tx1', tx1Amount)
  t.ok(balance.mempool.toMainUnit() === '70', 'Mempool balance should be reduced to 70')
  t.ok(balance.pending.toMainUnit() === '30', 'Pending balance should be increased to 30')
  
  balance.addTxid('confirmed', 'tx2', tx2Amount)
  t.ok(balance.mempool.toMainUnit() === '0', 'Mempool balance should be reduced to 0')
  t.ok(balance.confirmed.toMainUnit() === '70', 'Confirmed balance should be increased to 70')
  
  balance.addTxid('confirmed', 'tx1', tx1Amount)
  t.ok(balance.pending.toMainUnit() === '0', 'Pending balance should be reduced to 0')
  t.ok(balance.confirmed.toMainUnit() === '100', 'Confirmed balance should be increased to 100')
  
  t.ok(balance.txid.mempool.length === 0, 'Mempool txid list should be empty')
  t.ok(balance.txid.pending.length === 0, 'Pending txid list should be empty')
  t.ok(balance.txid.confirmed.length === 2, 'Confirmed txid list should have 2 transactions')
})

test('Balance - attempting to move non-existent transaction', (t) => {
  const balance = new Balance()
  const txAmount = new Bitcoin(50, 'main')
  
  balance.addTxid('pending', 'tx1', txAmount)
  balance.addTxid('confirmed', 'tx2', txAmount)  // tx2 doesn't exist in pending
  
  t.ok(balance.pending.toMainUnit() === '50', 'Pending balance should remain 50')
  t.ok(balance.confirmed.toMainUnit() === '50', 'Confirmed balance should be 50')
  t.ok(balance.txid.pending.length === 1, 'Pending txid list should still have 1 transaction')
  t.ok(balance.txid.confirmed.length === 1, 'Confirmed txid list should have 1 transaction')
})

test('Balance - moving transaction to the same state', (t) => {
  const balance = new Balance()
  const txAmount = new Bitcoin(50, 'main')
  
  balance.addTxid('confirmed', 'tx1', txAmount)
  t.ok(balance.confirmed.toMainUnit() === '50', 'Initial confirmed balance should be 50')
  
  balance.addTxid('confirmed', 'tx1', txAmount)
  t.ok(balance.confirmed.toMainUnit() === '50', 'Confirmed balance should still be 50')
  t.ok(balance.txid.confirmed.length === 1, 'Confirmed txid list should still have 1 transaction')
})
