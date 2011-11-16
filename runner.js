module.exports = Runner

var fs = require("fs")
  , child_process = require("child_process")
  , path = require("path")
  , chain = require("slide").chain
  , TapProducer = require("tap-producer")
  , TapConsumer = require("tap-consumer")
  , assert = require("tap-assert")
  , inherits = require("inherits")

inherits(Runner, TapProducer)

function Runner (dir, diag, cb) {
  Runner.super.call(this, diag)

  if (dir) this.run(dir, cb)
}

Runner.prototype.run = function () {
  var self = this
    , args = Array.prototype.slice.call(arguments)
    , cb = args.pop() || function (er) {
        if (er) self.emit("error", er)
        self.end()
      }
  if (Array.isArray(args[0])) args = args[0]
  self.runFiles(args, "", cb)
}

Runner.prototype.runDir = function (dir, cb) {
  var self = this
  fs.readdir(dir, function (er, files) {
    if (er) {
      self.write(assert.fail("failed to readdir "+dir,
                           { error: er }))
      self.end()
      return
    }
    files = files.sort(function (a,b) {return a>b ? 1 : -1})
    files = files.filter(function (f) {return !f.match(/^\./)})
    files = files.map(path.resolve.bind(path, dir))

    self.runFiles(files, path.resolve(dir), cb)
  })
}

Runner.prototype.runFiles = function (files, dir, cb) {
  var self = this
  chain(files.map(makeFileHandler), cb)

  return self
  
  function makeFileHandler(f) { return function (cb) {
    var relDir = dir || path.dirname(f)
      , fileName = relDir === "." ? f : f.substr(relDir.length + 1)
      , cmd
      , args = []
      , env = {}
      , err = ""
      , out = ""
      , tc = new TapConsumer
    
    for (var i in process.env) env[i] = process.env[i]
    env.TAP = 1

    self.write(fileName)
    fs.lstat(f, function (er, st) {
      if (er) {
        self.write(assert.fail("failed to stat "+f,
                               {error: er}))
        return cb()
      }

      cmd = f

      if (path.extname(f) === ".js") {
        cmd = "node"
        args = [fileName]
      } else if (path.extname(f) === ".coffee") {
        cmd = "coffee"
        args = [fileName]
      }
      if (st.isDirectory()) {
        return self.runDir(f, cb)
      }
      
      fs.readFile(f, 'utf8', runFile)
    })
    
    function runFile(er, fileSource) {
      if (er) {
        self.write(assert.fail("could not read "+f, {error: er}))
        return cb()
      }
      if (fileSource.slice(0, 2) === '#!') {
        args = fileSource.split('\n')[0].slice(2).trim().split(' ')
        cmd = args.shift()
        args.push(fileName)
      }
      var cp = child_process.spawn(cmd, args, { env: env, cwd: relDir })
        , childTests = [f]

      tc.on("data", function (c) {
        self.emit("result", c)
        self.write(c)
      })

      cp.stdout.pipe(tc)
      cp.stdout.on("data", function (c) { out += c })
      cp.stderr.on("data", function (c) { err += c })

      cp.on("exit", fileRan)
    }
    
    function fileRan(code) {
      //childTests.forEach(function (c) { self.write(c) })
      var res = { name: fileName
                , ok: !code }
      if (err) {
        res.stderr = err
        if (tc.results.ok && tc.results.tests === 0) {
          // perhaps a compilation error or something else failed...
          console.error(err)
        }
      }
      res.command = [cmd].concat(args).map(JSON.stringify).join(" ")
      self.emit("result", res)
      self.emit("file", f, res, tc.results)
      self.write(res)
      self.write("\n")
      cb()
    }
  }}
}
