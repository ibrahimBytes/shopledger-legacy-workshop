var test = require('node:test');
var assert = require('node:assert/strict');

var tax = require('../lib/tax');
var coupons = require('../lib/coupons');
var pricing = require('../lib/pricing');
var orders = require('../lib/orders');
var invoice = require('../lib/invoice');

test('tax resolves configured HSN slabs, explicit rates, and the 18% fallback', function () {
  assert.equal(tax.getRateForItem({ hsn: '1006' }), 0.05);
  assert.equal(tax.getRateForItem({ hsn: '0405' }), 0.12);
  assert.equal(tax.getRateForItem({ hsn: '0902' }), 0.18);
  assert.equal(tax.getRateForItem({ hsn: 'UNKNOWN' }), 0.18);
  assert.equal(tax.getRateForItem({ hsn: '1006', gstRate: 12 }), 0.12);
});

test('checkout apportions a capped coupon before HSN GST and splits the GST', function () {
  var totals = pricing.computeTotals([
    { id: 1, name: 'Rice', hsn: '1006', price: 1000, qty: 1 },
    { id: 2, name: 'Tea', hsn: '0902', price: 1000, qty: 1 }
  ], 'SAVE10');

  assert.deepEqual(totals, {
    subtotal: 2000,
    discount: 150,
    taxable: 1850,
    tax: 212.75,
    cgst: 106.38,
    sgst: 106.37,
    total: 2062.75,
    lines: [
      { id: 1, name: 'Rice', hsn: '1006', gstPercent: 5, gross: 1000, discount: 75, taxable: 925, tax: 46.25, net: 971.25 },
      { id: 2, name: 'Tea', hsn: '0902', gstPercent: 18, gross: 1000, discount: 75, taxable: 925, tax: 166.5, net: 1091.5 }
    ]
  });
  assert.equal(coupons.calculateDiscount(2000, 'SAVE10'), 150);
});

test('invoice uses the checkout HSN GST breakdown for persisted order lines', function () {
  var checkout = pricing.computeTotals([
    { id: 8, sku: 'BEV-001', name: 'Tea', hsn: '0902', price: 140, qty: 2 },
    { id: 2, sku: 'GRN-002', name: 'Dal', hsn: '0713', price: 165, qty: 2 }
  ], '');
  var figures = invoice.computeInvoiceFigures({
    items: [
      { id: 8, sku: 'BEV-001', name: 'Tea', hsn: '0902', price: 140, qty: 2 },
      { id: 2, sku: 'GRN-002', name: 'Dal', hsn: '0713', price: 165, qty: 2 }
    ],
    coupon: '',
    total: checkout.total
  });

  assert.deepEqual(checkout, {
    subtotal: 610,
    discount: 0,
    taxable: 610,
    tax: 66.9,
    cgst: 33.45,
    sgst: 33.45,
    total: 676.9,
    lines: [
      { id: 8, name: 'Tea', hsn: '0902', gstPercent: 18, gross: 280, discount: 0, taxable: 280, tax: 50.4, net: 330.4 },
      { id: 2, name: 'Dal', hsn: '0713', gstPercent: 5, gross: 330, discount: 0, taxable: 330, tax: 16.5, net: 346.5 }
    ]
  });
  assert.equal(figures.tax, checkout.tax);
  assert.equal(figures.cgst, checkout.cgst);
  assert.equal(figures.sgst, checkout.sgst);
  assert.equal(figures.total, checkout.total);
  assert.equal(figures.rows[1].gstPercent, 5);
  assert.equal(figures.rows[1].lineTax, 16.5);
});

test('invoice uses the checkout coupon cap and discounted taxable values', function () {
  var checkout = pricing.computeTotals([
    { id: 1, name: 'Rice', hsn: '1006', price: 1000, qty: 1 },
    { id: 2, name: 'Tea', hsn: '0902', price: 1000, qty: 1 }
  ], 'SAVE10');
  var figures = invoice.computeInvoiceFigures({
    items: [
      { id: 1, name: 'Rice', hsn: '1006', price: 1000, qty: 1 },
      { id: 2, name: 'Tea', hsn: '0902', price: 1000, qty: 1 }
    ],
    coupon: 'SAVE10',
    total: checkout.total
  });

  assert.equal(checkout.discount, 150);
  assert.equal(figures.discount, checkout.discount);
  assert.equal(figures.tax, checkout.tax);
  assert.equal(figures.total, checkout.total);
});

test('invoice matches totals persisted by orders.add', function () {
  var db = { nextOrderId: 1001, orders: [] };
  var checkout = pricing.computeTotals([
    { id: 2, name: 'Dal', hsn: '0713', price: 165, qty: 2 }
  ], '');
  var order = orders.add(db, {
    date: '01/01/2022',
    customer: 'In-memory customer',
    paymentMode: 'cash',
    items: [{ id: 2, name: 'Dal', hsn: '0713', price: 165, qty: 2 }],
    coupon: '',
    subtotal: checkout.subtotal,
    discount: checkout.discount,
    tax: checkout.tax,
    total: checkout.total
  });
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(db.orders.length, 1);
  assert.equal(order.total, 346.5);
  assert.equal(order.tax, 16.5);
  assert.equal(figures.tax, order.tax);
  assert.equal(figures.total, order.total);
});
