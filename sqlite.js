/**
 * Module handles database management
 *
 * Server API calls the methods in here to query and update the SQLite database
 */


const fs = require('fs');

const dbFile = './.data/autobuy.db';
const exists = fs.existsSync(dbFile);
const sqlite3 = require('sqlite3').verbose();
const dbWrapper = require('sqlite');
let db;

const AES = require('crypto-js/aes');
const CryptoJS = require('crypto-js');

let key = null;
let iv = null;
if (fs.existsSync('./.data/.key')) {
  key = fs.readFileSync('./.data/.key', {encoding: 'utf-8'});
  iv = fs.readFileSync('./.data/.iv', {encoding: 'utf-8'});
}
console.log('key=', key);
console.log('iv=', iv);

let admin = null;
global.isInitialized = function () {
  if (fs.existsSync('./.data/.admin')) {
    admin = fs.readFileSync('./.data/.admin', {encoding: 'utf-8'});
    return true;
  }
  return false;
};

global.initialize = function (argPass) {
  fs.writeFileSync('./.data/.admin', global.encryptAESToUTF8Base64(argPass));
};

global.isAdmin = function (argPass) {
  if (argPass == global.decryptAESFromUTF8Base64(admin)) {
    return true;
  }
  return false;
};

global.encryptAESToUTF8Base64 = function (plaintxt) {
  console.log('key=', key);
  console.log('iv=', iv);
  var _key = CryptoJS.enc.Base64.parse(key);
  var _iv = CryptoJS.enc.Base64.parse(iv);
  var encryptdata = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(plaintxt), _key, {iv: _iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  return encryptdata.ciphertext.toString(CryptoJS.enc.Base64);
};

global.decryptAESFromUTF8Base64 = function (encryptBase64Str) {
  console.log('key=', key);
  console.log('iv=', iv);
  var _key = CryptoJS.enc.Base64.parse(key);
  var _iv = CryptoJS.enc.Base64.parse(iv);
  var encryptdata = CryptoJS.enc.Base64.parse(encryptBase64Str);
  var decryptdata = CryptoJS.AES.decrypt({ciphertext:encryptdata}, _key, {iv: _iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  return decryptdata.toString(CryptoJS.enc.Utf8);
};

let initDB = async function () {
  let initializeddb = await dbWrapper
  .open({
    filename: dbFile,
    driver: sqlite3.Database
  })
  .then(async dBase => {
    db = dBase;

    // We use try and catch blocks throughout to handle any database errors
    try {
      // The async / await syntax lets us write the db operations in a way that won't block the app
      if (!exists) {
        // 暗号鍵の作成
        const crypto = require('crypto');
        key = CryptoJS.enc.Base64.stringify(CryptoJS.PBKDF2(crypto.randomBytes(8).toString('hex'), crypto.randomBytes(16).toString('hex'), {keySize: 4, iterations: 500}));
        iv = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Hex.parse(crypto.randomBytes(16).toString('hex')));
        console.log('key=', key);
        console.log('iv=', iv);
        fs.writeFileSync('./.data/.key', key);
        fs.writeFileSync('./.data/.iv', iv);

        await db.run(
          'CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, identify TEXT, label TEXT, enabled INTEGER, lastchecked TEXT)'
        );

        await db.run(
          'CREATE TABLE account (id INTEGER PRIMARY KEY AUTOINCREMENT, identify TEXT, pass TEXT, linetoken TEXT)'
        );
      }
      else {
        console.log(await db.all('SELECT * from items'));
      }
    }
    catch (dbError) {
      console.error(dbError);
    }
  })
  .catch(initerror => {
    console.error(initerror);
  });
  console.log('initializeddb=', initializeddb);
};

(async () => {
  await initDB();
});

// Our server script will call these methods to connect to the db
module.exports = {

  /**
   * Get the options in the database
   *
   * Return everything in the Choices table
   * Throw an error in case of db connection issues
   */
  getAccount: async () => {
    try {
      if (!db) {
        await initDB();
      }
      let accounts = await db.all('SELECT * FROM account LIMIT 1');
      if (accounts.length > 0) {
        console.log('account=', accounts);
        accounts[0].identify = global.decryptAESFromUTF8Base64(accounts[0].identify);
        console.log('accounts[0].identify=', accounts[0].identify);
        accounts[0].pass = global.decryptAESFromUTF8Base64(accounts[0].pass);
        if (accounts[0].linetoken) {
          accounts[0].linetoken = global.decryptAESFromUTF8Base64(accounts[0].linetoken);
        }
        return accounts[0];
      }
    } catch (dbError) {
      // Database connection error
      console.error(dbError);
    }
    return null;
  },

  saveAccount: async (identify, pass) => {
    try {
      identify = global.encryptAESToUTF8Base64(identify);
      pass = global.encryptAESToUTF8Base64(pass);
      console.log('encrypt identify=', identify);
      console.log('encrypt pass=', pass);
      if (!db) {
        await initDB();
      }
      const accounts = await db.all(
        'SELECT * FROM account WHERE identify = ?',
        identify
      );
      if (accounts.length > 0 && accounts[0].id) {
        await db.run(
          'UPDATE account SET identify = ?, pass = ? WHERE id = ?', [
          identify,
          pass,
          1
        ]);
      }
      else {
        await db.run('INSERT INTO account (identify, pass) VALUES (?, ?)', [
          identify,
          pass
        ]);
      }
      return true;
    }
    catch (dbError) {
      console.error(dbError);
    }
    return false;
  },

  saveLinetoken: async (linetoken) => {
    try {
      linetoken = global.encryptAESToUTF8Base64(linetoken);
      console.log('encrypt linetoken=', linetoken);
      if (!db) {
        await initDB();
      }
      await db.run(
        'UPDATE account SET linetoken = ? WHERE id = ?', [
        linetoken,
        1
      ]);
      return true;
    }
    catch (dbError) {
      console.error(dbError);
    }
    return false;
  },

  getItems: async () => {
    try {
      if (!db) {
        await initDB();
      }
      return await db.all('SELECT * from items ORDER BY id ASC');
    } catch (dbError) {
      console.error(dbError);
    }
    return null;
  },

  addItem: async (identify, label) => {
    try {
      if (!db) {
        await initDB();
      }
      const items = await db.all(
        'SELECT * FROM items WHERE identify = ?',
        identify
      );
      if (items.length > 0 && items[0].id) {
        await db.run(
          'UPDATE items SET label = ? WHERE id = ?', [
          label,
          items[0].id
        ]);
      }
      else {
        await db.run('INSERT INTO items (identify, label, enabled) VALUES (?, ?, 1)', [
          identify,
          label
        ]);
      }
      return true;
    }
    catch (dbError) {
      console.error(dbError);
    }
    return false;
  },

  removeItem: async (id) => {
    try {
      if (!db) {
        await initDB();
      }
      await db.run(
        'DELETE FROM items WHERE id = ?', [
        id
      ]);
      return true;
    }
    catch (dbError) {
      console.error(dbError);
    }
    return false;
  },

  checkdItem: async (identify) => {
    try {
      if (!db) {
        await initDB();
      }
      await db.run(
        'UPDATE items SET lastchecked = ? WHERE identify = ?', [
        new Date(new Date().getTime() + 60 * 60  * 9 * 1000).toLocaleString('ja-JP'),
        identify
      ]);
      return true;
    }
    catch (dbError) {
      console.error(dbError);
    }
    return false;
  },

  disableItem: async (identify) => {
    try {
      if (!db) {
        await initDB();
      }
      await db.run(
        'UPDATE items SET enabled = 0, lastchecked = ? WHERE identify = ?', [
        new Date(new Date().getTime() + 60 * 60  * 9 * 1000).toLocaleString('ja-JP'),
        identify
      ]);
      return true;
    }
    catch (dbError) {
      console.error(dbError);
    }
    return false;
  },
};
