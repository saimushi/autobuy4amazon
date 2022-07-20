/**
 * This is the main Node.js server script for your project
 * Check out the two endpoints this back-end API provides in fastify.get and fastify.post below
 */

const path = require("path");

// Require the fastify framework and instantiate it
const fastify = require("fastify")({
  // Set this to true for detailed logging:
  logger: false,
});

// ADD FAVORITES ARRAY VARIABLE FROM TODO HERE

// Setup our static files
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "public"),
  prefix: "/", // optional: default '/'
});

// Formbody lets us parse incoming forms
fastify.register(require("@fastify/formbody"));

// View is a templating manager for fastify
fastify.register(require("@fastify/view"), {
  engine: {
    handlebars: require("handlebars"),
  },
});

/**
 * Our home page route
 *
 * Returns src/pages/index.hbs with data built into it
 */
 //fastify.get("/", function (request, reply) {
 fastify.register(require('fastify-markdown'), {src: true, markedOptions: { gfm: false }}).get("/", async function (request, reply) {
   // params is an object we'll pass to our handlebars template
   const readme = await reply.markdown('README.md');
   // The Handlebars code will be able to access the parameter values and build them into the page
   //return reply.view("/src/pages/index.hbs", params);
   return reply.code(200).header('Content-Type', 'text/html; charset=utf-8')
   .send('<html><head><title>Amazon自動購入Bot</title><body>' + readme + '</body><script>const elements = document.getElementsByTagName(\'a\'); for(let element of elements){ element.setAttribute(\'target\', \'_blank\'); }</script></html>');
 });

// Run the server and report out to the logs
fastify.listen(
  { port: process.env.PORT, host: "0.0.0.0" },
  function (err, address) {
    if (err) {
      fastify.log.error(err);
      process.exit(1);
    }
    console.log(`Your app is listening on ${address}`);
    fastify.log.info(`server listening on ${address}`);
  }
);


// autobuy batch
const identify = process.env.IDENTIFY;
const pass = process.env.PASS;
const linetoken = process.env.LINETOKEN;
const item1 = process.env.ITEM1;
const item2 = process.env.ITEM2;
const item3 = process.env.ITEM3;
const item4 = process.env.ITEM4;
const item5 = process.env.ITEM5;
const maxitems = 5;

const fs = require('fs');
const request = require('request');
const puppeteer = require('puppeteer');

let browser = null;
let page = null;

let items = [null, null, null, null, null, ];
if ('string' == typeof item1) {
  items[0] = { id: item1, buycount: 0, usecount: 1 };
}
if ('string' == typeof item2) {
  items[1] = { id: item2, buycount: 0, usecount: 1 };
}
if ('string' == typeof item3) {
  items[2] = { id: item3, buycount: 0, usecount: 1 };
}
if ('string' == typeof item4) {
  items[3] = { id: item4, buycount: 0, usecount: 1 };
}
if ('string' == typeof item5) {
  items[4] = { id: item5, buycount: 0, usecount: 1 };
}
console.log('items=', items);

const notifyLine = async function (argtoken, argmessage, argimagepath) {
  let formdata = { message: '\n' + argmessage };
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
      //console.log('response=', response);
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

const checkAmazon = async function (argid, argpass, argitemid) {
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
      await notifyLine(linetoken, targetURL + '?m=AN1VRQENFRJN5\nは購入出来る状態です。購入を試みます。');
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
        return await buyAmazon(argitemid, true);
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
          return await buyAmazon(argitemid, true, true);
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
      await notifyLine(linetoken, targetURL + '?tag=isurut-22&linkCode=osi&th=1&psc=1&aod=1\nは購入出来る状態です。購入を試みます。');
      console.log('販売者一覧ヘッダーの販売元がAmazonなので購入を試みる');

      console.log('販売者一覧ヘッダーからカートに追加');
      await page.evaluate(function(selector) {
        return document.querySelector(selector).click();
      }, '#aod-pinned-offer input[name="submit.addToCart"]');
      await page.waitForTimeout(1000);
      console.log('販売者一覧ヘッダーからカートに追加 OK');
      return await buyAmazon(argitemid);
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
      await notifyLine(linetoken, targetURL + '?tag=isurut-22&linkCode=osi&th=1&psc=1&aod=1\nは購入出来る状態です。購入を試みます。');
      console.log('販売者一覧にAmazonがあるで購入を試みる 行番号=', (sidx+1));

      console.log('販売者一覧からカートに追加');
      await page.evaluate(function(selector) {
        return document.querySelector(selector).click();
      }, '#aod-offer-list #aod-offer-' + (sidx+1) + ' input[name="submit.addToCart"]');
      await page.waitForTimeout(1000);
      console.log('販売者一覧からカートに追加 OK');
      await page.screenshot({ path: 'screenshot.png'});
      return await buyAmazon(argitemid);
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

let authorized = false;
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
  //await notifyLine(linetoken, 'ログイン成功');
  return;
};

const buyAmazon = async function (argitemid, argViewCartSkiped, argReserve) {
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
      await notifyLine(linetoken, targetURL + '?m=AN1VRQENFRJN5\nは予約完了しました。\n成功したかどうか確認して下さい。\nhttps://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first', 'screenshot.png');
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
      await notifyLine(linetoken, targetURL + '?m=AN1VRQENFRJN5\nは注文完了しました。\n成功したかどうか確認して下さい。\nhttps://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first', 'screenshot.png');
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
      await notifyLine(linetoken, targetURL + '?m=AN1VRQENFRJN5\nは注文済みでした。\n注文済みかどうか確認して下さい。\nhttps://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first');
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
        await notifyLine(linetoken, targetURL + '?m=AN1VRQENFRJN5\nは注文済みでした。\n注文済みかどうか確認して下さい。\nhttps://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first');
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
    await notifyLine(linetoken, targetURL + '?m=AN1VRQENFRJN5\nは注文失敗しました。リトライします。\n実際に失敗したかどうか確認して下さい。\nhttps://www.amazon.co.jp/gp/css/order-history?ref_=nav_orders_first', 'screenshot.png');
  }

  return result;
};

// autoby Core
const autobuyCore = async function () {
  console.log('loop batch start', new Date().toLocaleString());
  await notifyLine(linetoken, '監視をスタート');
  let targetidx = 0;
  while(true) {
    console.log('ループ開始', (targetidx+1));
    let res = null;
    let item = items[targetidx];
    if (item) {
      if (item.buycount < item.usecount) {
        console.log('購入が完了していないアイテムを検知 行番号' + (targetidx+1), item);
        res = await checkAmazon(identify, pass, item.id);
        console.log('res=', res);
        if (true === res) {
          items[targetidx].buycount++;
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
        // 30秒後に再トライ
        console.log('30秒のインターバルを挟む 次の行番号', (targetidx+1));
        const timer = await new Promise(function (resolve) {
          setTimeout(function () {
            resolve(true);
          }, 30000);
        });
      }
    }
    // XXX 購入の失敗はしつこく再処理するのでidxはインクリメントしない！
  }
};

autobuyCore();
