// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var common = require('../common');
var assert = require('assert');
var fs = require('fs');

var TCP = process.binding('tcp_wrap').TCP;

var server = new TCP();

var r = server.bind('0.0.0.0', common.PORT);
assert.equal(0, r);

server.listen(128);

var slice, sliceCount = 0, eofCount = 0;

var writeCount = 0;
var recvCount = 0;

// write a buffer larger than tcp_wmem_max
var tcp_wmem_max = parseInt(fs.readFileSync('/proc/sys/net/core/wmem_max', 'utf8'));
var buf = new Buffer(tcp_wmem_max+10);
buf.fill("x");

var serverRecvedBuf = new Buffer(0);
var clientRecvedBuf = new Buffer(0);

server.onconnection = function(client) {
  assert.equal(0, client.writeQueueSize);
  console.log('got connection');

  function maybeCloseClient() {
    if (client.pendingWrites.length == 0 && client.gotEOF) {
      console.log('close client');
      client.close();
    }
  }

  client.pendingWrites = [];
  client.readStart();

  var req = client.writeBuffer(buf);
  client.pendingWrites.push(req);

  console.log('client.writeQueueSize: ' + client.writeQueueSize);

  req.oncomplete = function(status, client_, req_) {
    assert.equal(req, client.pendingWrites.shift());

    // Check parameters.
    assert.equal(0, status);
    assert.equal(client, client_);
    assert.equal(req, req_);

    console.log('oncomplete, client.writeQueueSize: ' + client.writeQueueSize);
    assert.equal(0, client.writeQueueSize);

    writeCount++;
    console.log('write ' + writeCount);
    maybeCloseClient();
  };

  client.onread = function(buffer, offset, length) {
    if (buffer) {
      assert.ok(length > 0);

      serverRecvedBuf = Buffer.concat([serverRecvedBuf, buffer.slice(offset, offset + length)]);
      sliceCount++;
    } else {
      console.log('eof');
      client.gotEOF = true;
      server.close();
      eofCount++;
      maybeCloseClient();
    }
  };
};

var net = require('net');

var c = net.createConnection(common.PORT);

c.on('data', function(d) {
  c.write(d);
  clientRecvedBuf = Buffer.concat([clientRecvedBuf, d]);
  recvCount++;
  if (clientRecvedBuf.length >= buf.length) {
    c.end();
  };
});

c.on('close', function() {
  console.error('client closed');
});

process.on('exit', function() {
  assert.equal(serverRecvedBuf.length, buf.length);
  assert.ok(sliceCount > 1);
  assert.equal(1, eofCount);
  assert.equal(1, writeCount);
  assert.ok(recvCount > 1);
});
