/**
 * This is the main server script that provides the API endpoints
 * The script uses the database helper in /src
 * The endpoints retrieve, update, and return data to the page handlebars files
 *
 * The API returns the front-end UI handlebars pages, or
 * Raw json if the client requests it with a query parameter ?raw=json
 */

const fs = require('fs');
const path = require('path');
const request = require('request');
const puppeteer = require('puppeteer');

const url = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
const db = require('./sqlite.js');
const maxitems = 5;

let browser = null;
let page = null;
let linetoken = null;
let authorized = false;

const notifyLine = async function (argtoken, argmessage, argimagepath) {
  let formdata = { message: 'abot ' + argmessage };
  if ('string' == typeof argimagepath && 0 < argimagepath.length) {
    formdata['imageFile'] = fs.createReadStream(argimagepath);
  }
  const options = {
    url: 'https://notify-api.line.me/api/notify',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Bearer ${argtoken}` },
    formData: formdata,
    json: true,
  };
  const res = await new Promise (function (resolve) {
    request(options, function (error, response, body) {
      if (response.statusCode == 200) {
        resolve(body);
      }
      else {
        resolve(error);
      }
    });
  });
  console.log('notify res=', res);
  return res;
};

const initAmazon = async function () {
 if (browser) {
   return;
 }
 console.log('ブラウザ初期化');
 //browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'], });
 browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox']});
 page = await browser.newPage();
 await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 7_0 like Mac OSX) AppleWebKit/537.51.1 (KHTML, like Gecko) Version/7.0 Mobile/11A465 Safari/9537.53');
 await page.setViewport({ width: 480, height: 960, });
 await page.setDefaultTimeout(20000);
 console.log('ブラウザ初期化 OK');
 return;
};

const loginAmazon = async function (argid, argpassd) {
 if (authorized) {
   console.log('ログイン済 スキップ');
   return;
 }
 console.log('ログイン id=', argid);
 console.log('ログイン pass=', argpassd);
 await page.goto('https://www.amazon.co.jp/ap/signin?_encoding=UTF8&openid.assoc_handle=jpflex&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.mode=checkid_setup&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&openid.ns.pape=http%3A%2F%2Fspecs.openid.net%2Fextensions%2Fpape%2F1.0&openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.co.jp%2F%3Fref_%3Dnav_signin');
 await page.waitForSelector('form[name="signIn"]');
 await page.evaluate(function(email, passwd) {
   document.querySelector('#ap_email').value = email;
   document.querySelector('#ap_password').value = passwd;
   document.querySelector('#signInSubmit').click();
 }, argid, argpassd);
 await page.waitForSelector('#nav-cart-count');
 authorized = true;
 console.log('ログイン OK');
 await page.screenshot({ path: 'screenshot.png'});
 await notifyLine(linetoken, 'ログイン成功', 'screenshot.png');
 return;
};


/* WebUI部分 ココから */

// Require the fastify framework and instantiate it
const fastify = require('fastify')({
  // Set this to true for detailed logging:
  logger: false,
});

// Setup our static files
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'src/pages/static'),
  prefix: '/static/', // optional: default '/'
});

// Formbody lets us parse incoming forms
fastify.register(require('@fastify/formbody'));

// View is a templating manager for fastify
fastify.register(require('@fastify/view'), {
  engine: {
    handlebars: require('handlebars'),
  },
});

fastify.register(require('fastify-markdown'), {
  src: true, markedOptions: { gfm: false }
});

const authenticate = {realm: 'Westeros'};
const validate = async function (username, password, req, reply, done) {
  if (username === 'admin' && global.isAdmin(password)) {
    return;
  }
  return new Error('ユーザー名かパスワードが間違っています。');
};
fastify.register(require('@fastify/basic-auth'), { validate, authenticate });

fastify.get('/healthcheck', async (request, reply) => {
  let params = request.query.raw ? {} : { healthcheck: true, url: url, };
  return request.query.raw
    ? reply.send(params)
    : reply.view('/src/pages/index.hbs', params);
});

fastify.get('/', async (request, reply) => {
  if (!global.isInitialized()) {
    const readme = await reply.markdown('README.md');
    return reply.code(200).header('Content-Type', 'text/html; charset=utf-8')
    .send('<html><head><title>Amazon自動購入Bot</title><body>' + readme + '</body><script>const elements = document.getElementsByTagName(\'a\'); for(let element of elements){ if (-1 < element.getAttribute(\'href\').indexOf(\'http\')) { element.setAttribute(\'target\', \'_blank\'); } }</script></html>');
  }
  return reply.redirect(url + '/items');
});

fastify.get('/initialize', async (request, reply) => {
  if (global.isInitialized()) {
    return reply.redirect(url);
  }
  let params = request.query.raw ? {} : { initialize: true, url: url, };
  return request.query.raw
    ? reply.send(params)
    : reply.view('/src/pages/index.hbs', params);
});

fastify.post('/initialize', async (request, reply) => {
  if (global.isInitialized()) {
    return reply.redirect(url);
  }
  let params = request.query.raw ? {} : { initialize: true, url: url, };
  if (request.body.pass) {
    global.initialize(request.body.pass);
    return reply.redirect(url);
  }
  return request.query.raw
    ? reply.send(params)
    : reply.view('/src/pages/index.hbs', params);
});

fastify.after(() => {
  fastify.route({
    method: 'GET',
    url: '/account',
    onRequest: fastify.basicAuth,
    handler: async (request, reply) => {
      if (!global.isInitialized()) {
        return reply.redirect(url);
      }
      let params = request.query.raw ? {} : { setup: true, url: url, };
      const account = await db.getAccount();
      if (account) {
        params.identify = account.identify;
      }
      return request.query.raw
        ? reply.send(params)
        : reply.view('/src/pages/index.hbs', params);
    }
  })
});

fastify.after(() => {
  fastify.route({
    method: 'POST',
    url: '/account',
    onRequest: fastify.basicAuth,
    handler: async (request, reply) => {
      if (!global.isInitialized()) {
        return reply.redirect(url);
      }
      let params = request.query.raw ? {} : { setup: true, url: url, };
      if (request.body.identify && request.body.pass) {
        params.identify = request.body.identify;
        let res = true;
        // ログインテスト
        try {
          await initAmazon();
          await loginAmazon(request.body.identify, request.body.pass);
        }
        catch (error) {
          console.error('login test error=', error);
          params.error = '入力された情報ではAmazonにログイン出来ませんでした。';
          res = false;
        }
        if (res) {
          res = await db.saveAccount(request.body.identify, request.body.pass);
          if (res) {
            return reply.redirect(url);
          }
          params.error = 'システムエラーによりアカウントの保存が出来ませんでした。暫く経ってから再度お試し下さい。';
          res = false;
        }
      }
      return request.query.raw
        ? reply.send(params)
        : reply.view('/src/pages/index.hbs', params);
    }
  })
});

fastify.after(() => {
  fastify.route({
    method: 'GET',
    url: '/line',
    onRequest: fastify.basicAuth,
    handler: async (request, reply) => {
      if (!global.isInitialized()) {
        return reply.redirect(url);
      }
      let params = request.query.raw ? {} : { line: true, url: url, };
      const account = await db.getAccount();
      if (account) {
        params.linetoken = account.linetoken;
      }
      return request.query.raw
        ? reply.send(params)
        : reply.view('/src/pages/index.hbs', params);
    }
  })
});

fastify.after(() => {
  fastify.route({
    method: 'POST',
    url: '/line',
    onRequest: fastify.basicAuth,
    handler: async (request, reply) => {
      if (!global.isInitialized()) {
        return reply.redirect(url);
      }
      let params = request.query.raw ? {} : { line: 1, url: url, };
      if (request.body.linetoken) {
        params.linetoken = request.body.linetoken;
        if (await db.saveLinetoken(request.body.linetoken)) {
          return reply.redirect(url);
        }
        params.error = 'システムエラーによりLINEトークンの保存が出来ませんでした。暫く経ってから再度お試し下さい。';
      }
      return request.query.raw
        ? reply.send(params)
        : reply.view('/src/pages/index.hbs', params);
    }
  })
});

fastify.after(() => {
  fastify.route({
    method: 'GET',
    url: '/items',
    onRequest: fastify.basicAuth,
    handler: async (request, reply) => {
      if (!global.isInitialized()) {
        return reply.redirect(url);
      }
      let params = request.query.raw ? {} : { item: true, url: url, };
      const account = await db.getAccount();
      if (account) {
        console.log('account=', account);
        params.identify = account.identify;
        params.linetoken = account.linetoken;
        params.items = await db.getItems();
        console.log('items=', params.items);
        if (params.items && params.items.length >= maxitems) {
          params.maxitem = true;
        }
      }
      else {
        return reply.redirect(url + '/account');
      }
      return request.query.raw
        ? reply.send(params)
        : reply.view('/src/pages/index.hbs', params);
    }
  })
});

fastify.after(() => {
  fastify.route({
    method: 'POST',
    url: '/items',
    onRequest: fastify.basicAuth,
    handler: async (request, reply) => {
      if (!global.isInitialized()) {
        return reply.redirect(url);
      }
      let params = request.query.raw ? {} : { item: true, url: url, };
      if (request.body.mode == 'additem') {
        if (request.body.itemid && request.body.itemname) {
          if (await db.addItem(request.body.itemid, request.body.itemname)) {
            return reply.redirect(url);
          }
          params.error = 'システムエラーにより商品の保存が出来ませんでした。暫く経ってから再度お試し下さい。';
        }
      }
      else if (request.body.mode == 'removeitem') {
        if (request.body.id) {
          if (await db.removeItem(request.body.id)) {
            return reply.redirect(url);
          }
          params.error = 'システムエラーにより商品の削除が出来ませんでした。暫く経ってから再度お試し下さい。';
        }
      }
      else {
        return reply.redirect(url);
      }
      return request.query.raw
        ? reply.send(params)
        : reply.view('/src/pages/index.hbs', params);
    }
  })
});

fastify.listen(
  { port: process.env.PORT, host: '0.0.0.0' },
  function (err, address) {
    if (err) {
      fastify.log.error(err);
      process.exit(1);
    }
    console.log(`Your app is listening on ${address}`);
    fastify.log.info(`server listening on ${address}`);
  }
);
/* WebUI部分 ココまで */


/* 自動購入バッチ部分 ココから */
const checkAmazon = async function (argid, argpass, argitemid, argitemlabel) {
  await initAmazon();
  await loginAmazon(argid, argpass);

  let targetURL = 'https://www.amazon.co.jp/dp/' + argitemid;
  console.log('商品ページ移動', targetURL + '?m=AN1VRQENFRJN5');
  try {
    await page.goto(targetURL + '?m=AN1VRQENFRJN5');
    await page.waitForSelector('#nav-cart-count');
    console.log('商品ページ移動 OK');
  }
  catch (error) {
    console.log('商品ページ移動 失敗', error);
    return false;
  }

  console.log('販売元がAmazonかどうか');
  try {
    const seller = await page.evaluate(function(selector) {
      return document.querySelector(selector).textContent.trim();
    }, '#tabular_feature_div .tabular-buybox-text[tabular-attribute-name="販売元"] span');
    console.log('販売元=', seller);
    //if (-1 < seller.indexOf('鳶色')) {// XXX テスト購入用
    if (0 === seller.indexOf('Amazon')) {
      await notifyLine(linetoken, '購入可能1 ' + argitemlabel + '\n' + targetURL + '?m=AN1VRQENFRJN5\nは購入出来る状態です。購入を試みます。');
      console.log('販売元がAmazonなのでそのまま購入を試みる');

      console.log('カートに追加出来るか');
      const iselement = await page.evaluate(function(selector) {
        return (document.querySelector(selector)) ? true : false;
      }, '#add-to-cart-button');
      if (iselement) {
        console.log('カートに追加 iselement=', iselement);
        await page.evaluate(function(selector) {
          return document.querySelector(selector).click();
        }, '#add-to-cart-button');
        console.log('カートに追加 OK?');
        await page.waitForSelector('#sc-mini-buy-box');
        //await page.waitForTimeout(1000);
        console.log('カートに追加 OK');
        return await buyAmazon(argitemid, argitemlabel, true);
      }
      else {
        console.log('予約商品ではないか？');
        // 予約アイテムかどうかを確認
        const isrelement = await page.evaluate(function(selector) {
          return (document.querySelector(selector)) ? true : false;
        }, '#buy-now-button[title="今すぐ予約注文する"]');
        if (isrelement) {
          console.log('今すぐ予約する isrelement=', isrelement);
          // 予約注文
          await page.evaluate(function(selector) {
            return document.querySelector(selector).click();
          }, '#buy-now-button');
          console.log('今すぐ予約する OK?');
          await page.waitForSelector('input[name="placeYourOrder1"]');
          console.log('今すぐ予約する OK');
          // 予約
          return await buyAmazon(argitemid, argitemlabel, true, true);
        }
      }
    }
    console.log('販売元がAmazonじゃ無い');
  }
  catch (error) {
    console.log('販売元がそもそも無い', error);
  }

  console.log('販売元が無いので販売者一覧にAmazonが居ないかチェックする');
  try {
    console.log('販売者一覧に移動');
    await page.goto(targetURL + '?tag=isurut-22&linkCode=osi&th=1&psc=1&aod=1');
    await page.waitForSelector('#atc-toast-overlay');
    console.log('販売者一覧に移動 OK');
  }
  catch (error) {
    console.log('販売者一覧に移動 失敗');
    return false;
  }

  console.log('販売者一覧ヘッダーがAmazonかどうか');
  try {
    const seller = await page.evaluate(function(selector) {
      return document.querySelector(selector).textContent.trim();
    }, '#aod-pinned-offer #aod-offer-soldBy .a-fixed-left-grid-col.a-col-right a');
    console.log('販売者一覧ヘッダー販売元=', seller);
    if (0 === seller.indexOf('Amazon')) {
    //if (-1 < seller.indexOf('port town')) {// XXX テスト購入用
    //if (0 < seller.indexOf('Amazon')) {// XXX このブロック後をテストする時用
      await notifyLine(linetoken, '購入可能2 ' + argitemlabel + '\n' + targetURL + '?tag=isurut-22&linkCode=osi&th=1&psc=1&aod=1\nは購入出来る状態です。購入を試みます。');
      console.log('販売者一覧ヘッダーの販売元がAmazonなので購入を試みる');

      console.log('販売者一覧ヘッダーからカートに追加');
      await page.evaluate(function(selector) {
        return document.querySelector(selector).click();
      }, '#aod-pinned-offer input[name="submit.addToCart"]');
      await page.waitForTimeout(1000);
      console.log('販売者一覧ヘッダーからカートに追加 OK');
      return await buyAmazon(argitemid, argitemlabel);
    }
    console.log('販売者一覧ヘッダーがAmazonじゃ無い');
  }
  catch (error) {
    console.log('販売者一覧ヘッダーがそもそも無い');
  }

  console.log('販売者一覧にAmazonがあるかどうか');
  try {
    const sellers = await page.evaluate((selector) => {
       const list = Array.from(document.querySelectorAll(selector));
       return list.map(data => {
         return (-1 < data.textContent.trim().indexOf('Amazon')) ? 'Amazon' : data.textContent.trim();
       });
     }, '#aod-offer-list #aod-offer-soldBy .a-fixed-left-grid-col.a-col-right a');
    console.log('販売者一覧=', sellers);
    const sidx = sellers.indexOf('Amazon');
    if (-1 < sidx) {
      await notifyLine(linetoken, '購入可能3 ' + argitemlabel + '\n' + targetURL + '?tag=isurut-22&linkCode=osi&th=1&psc=1&aod=1\nは購入出来る状態です。購入を試みます。');
      console.log('販売者一覧にAmazonがあるで購入を試みる 行番号=', (sidx+1));

      console.log('販売者一覧からカートに追加');
      await page.evaluate(function(selector) {
        return document.querySelector(selector).click();
      }, '#aod-offer-list #aod-offer-' + (sidx+1) + ' input[name="submit.addToCart"]');
      await page.waitForTimeout(1000);
      console.log('販売者一覧からカートに追加 OK');
      await page.screenshot({ path: 'screenshot.png'});
      return await buyAmazon(argitemid, argitemlabel);
    }
    console.log('販売者一覧にAmazonが無い');
  }
  catch (error) {
    console.log('販売者一覧がそもそも無い');
  }

  console.log('購入出来る状態では無かった');
  //await notifyLine(linetoken, targetURL + '\nは購入出来る状態ではありませんでした。');

  return null;
};

const buyAmazon = async function (argitemid, argitemlabel, argViewCartSkiped, argReserve) {
  let result = false;
  const targetURL = 'https://www.amazon.co.jp/dp/' + argitemid;
  try {
    if (true !== argViewCartSkiped) {
      console.log('カートを表示');
      await page.goto('https://www.amazon.co.jp/gp/aw/c?ref_=navm_hdr_cart');
      await page.waitForSelector('#nav-cart-count');
      console.log('カートを表示 OK');
    }

    if (argReserve) {
      console.log('予約注文の確定');
      await page.evaluate(function(selector) {
        return document.querySelector(selector).click();
      }, 'input[name="placeYourOrder1"]');
      await page.waitForSelector('#widget-purchaseConfirmationStatus');
      console.log('予約注文完了 OK');
      await page.screenshot({ path: 'screenshot.png'});
      await notifyLine(linetoken, '予約成功 '  + argitemlabel + '\n' + targetURL + '?m=AN1VRQENFRJN5\nは予約完了しました。\n成功したかどうか確認して下さい。\nhttps://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first', 'screenshot.png');
    }
    else {
      console.log('レジに進む');
      await page.evaluate(function(selector) {
        return document.querySelector(selector).click();
      }, 'input[name="proceedToRetailCheckout"]');
      await page.waitForSelector('#shipping-summary');
      console.log('レジに進む OK');

      console.log('注文の確定');
      await page.evaluate(function(selector) {
        return document.querySelector(selector).click();
      }, 'input[name="placeYourOrder1"]');
      await page.waitForSelector('#widget-purchaseConfirmationStatus');
      console.log('注文完了');
      await page.screenshot({ path: 'screenshot.png'});
      await notifyLine(linetoken, '購入完了 ' + argitemlabel + '\n' + targetURL + '?m=AN1VRQENFRJN5\nは購入完了しました。\n成功したかどうか確認して下さい。\nhttps://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first', 'screenshot.png');
    }

    console.log('注文が成功したかどうかをチェック');
    const success = await page.evaluate(function(selector) {
      return document.querySelector(selector).textContent;
    }, '#widget-purchaseConfirmationStatus');
    console.log('success=', success);
    if (-1 < success.indexOf('注文が確定')) {
      console.log('注文成功');
      //await page.screenshot({ path: 'screenshot.png'});
      return true;
    }
    console.log('注文失敗');
  }
  catch (error) {
    console.log('注文完了出来す', error);
  }

  console.log('実は既に購入済みでは無かったかをエラーから確認を試みる1');
  try {
    let aleadybuy = await page.evaluate(function(selector) {
      return document.querySelector(selector).textContent;
    }, '.a-alert-content [data-messageid="quantityPermittedLimitViolation"]');
    console.log('aleadybuy=', aleadybuy);
    if ('string' == typeof aleadybuy && -1 < aleadybuy.indexOf('購入数の制限があります')) {
      console.log('実は既に購入済みだったので購入成功として処理2');
      result = true;
      await notifyLine(linetoken, '二重購入 ' + argitemlabel + '\n' + targetURL + '?m=AN1VRQENFRJN5\nは購入済みでした。\n購入済みかどうか確認して下さい。\nhttps://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first');
    }
  }
  catch (error) {
    console.log('既に購入済みかどうか確認出来ず1', error);
  }

  if (true !== result) {
    console.log('実は既に購入済みでは無かったかをエラーから確認を試みる2');
    try {
      let aleadybuy = await page.evaluate(function(selector) {
        return document.querySelector(selector).textContent;
      }, '.a-spacing-base.item-row:first-child .a-alert-inline-error .a-spacing-small');
      console.log('aleadybuy=', aleadybuy);
      if ('string' == typeof aleadybuy && -1 < aleadybuy.indexOf('購入数に制限があります')) {
        console.log('実は既に購入済みだったので購入成功として処理2');
        result = true;
        await notifyLine(linetoken, '二重購入 ' + argitemlabel + '\n' + targetURL + '?m=AN1VRQENFRJN5\nは購入済みでした。\n購入済みかどうか確認して下さい。\nhttps://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first');
      }
    }
    catch (error) {
      console.log('既に購入済みかどうか確認出来ず2', error);
    }
  }

  if (true === result) {
    console.log('カートに残ってたら削除しておく');
    try {
      console.log('空にする為のカートを表示');
      await page.goto('https://www.amazon.co.jp/gp/aw/c?ref_=navm_hdr_cart');
      await page.waitForSelector('#nav-cart-count');
      console.log('空にする為のカートを表示 OK');
      let is = await page.evaluate(function(selector) {
        return (document.querySelector(selector)) ? true : false;
      }, 'input[name="proceedToRetailCheckout"]');
      if (is) {
        console.log('アイテム削除');
        await page.evaluate(function(selector) {
          return document.querySelector(selector).click();
        }, '.sc-list-item:first-child .sc-list-item-content input[data-action="delete"]');
        console.log('アイテム削除 OK?');
        await page.waitForSelector('.sc-list-item-removed-msg .a-padding-mini[data-action="delete"]');
        console.log('アイテム削除 OK');
      }
    }
    catch (error) {
      console.log('カートを空に出来ず', error);
    }
  }
  else {
    await page.screenshot({ path: 'screenshot.png'});
    await notifyLine(linetoken, '購入失敗 ' + argitemlabel + '\n' + targetURL + '?m=AN1VRQENFRJN5\nは購入失敗しました。リトライします。\n実際に失敗したかどうか確認して下さい。\nhttps://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first', 'screenshot.png');
  }

  return result;
};

// autoby Core
const autobuyCore = async function () {
  console.log('loop batch start', new Date().toLocaleString());
  const account = await db.getAccount();
  console.log('batch account=', account);
  const identify = account.identify;
  const pass = account.pass;
  linetoken = account.linetoken;
  await notifyLine(linetoken, '監視スタート');
  let targetidx = 0;
  while(true) {
    console.log('ループ開始', (targetidx+1));
    let res = null;
    let items = await db.getItems();
    let item = items[targetidx];
    if (item) {
      if (item.enabled) {
        console.log('購入が完了していないアイテムを検知 行番号' + (targetidx+1), item);
        res = await checkAmazon(identify, pass, item.identify, item.label);
        console.log('res=', res);
        if (true === res) {
          // 購入済みに更新
          await db.disableItem(item.identify);
        }
        else {
          // 最終チェック日付更新
          await db.checkdItem(item.identify);
        }
      }
    }
    console.log('ループ終了', (targetidx+1));
    if (null === res) {
      // 次のアイテムのチェック
      targetidx++;
      if ((maxitems-1) < targetidx) {
        // アイテムは5つまでなので5つのチェックが終わったら30秒待って頭に戻る
        targetidx = 0;
        // 20秒後に再トライ
        console.log('20秒のインターバルを挟む 次の行番号', (targetidx+1));
        const timer = await new Promise(function (resolve) {
          setTimeout(function () {
            resolve(true);
          }, 20000);
        });
      }
    }
    // XXX 購入の失敗はしつこく再処理するのでidxはインクリメントしない！
  }
};

autobuyCore();

/* 自動購入バッチ部分 ココまで */
