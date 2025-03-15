require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const app = express();

// Telegram configuration
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const allowedUsers = process.env.ALLOWED_TELEGRAM_USERS ? process.env.ALLOWED_TELEGRAM_USERS.split(',').map(id => id.trim()) : [];

// Solana configuration - Helius API
const connection = new Connection(process.env.SOLANA_RPC_URL, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 60000
});
const minSolAmount = parseFloat(process.env.MIN_SOL_AMOUNT);
const heliusApiKey = process.env.HELIUS_API_KEY;
const heliusApiUrl = `https://api.helius.xyz/v0`;
const solscanApiKey = process.env.SOLSCAN_API_KEY;

// Wallet tracking data
let wallets = [];
if (process.env.WALLET_ADDRESSES && process.env.WALLET_ADDRESSES.trim()) {
  const addresses = process.env.WALLET_ADDRESSES.split(',');
  wallets = addresses.map((addr, index) => ({
    address: addr.trim(),
    name: `محفظة ${index + 1}`
  })).filter(wallet => wallet.address);
  console.log('تم تحميل المحافظ من المتغيرات البيئية:', wallets);
}

// Load wallets from file if it exists
try {
  if (fs.existsSync('wallets.json')) {
    const data = fs.readFileSync('wallets.json', 'utf8');
      const loadedWallets = JSON.parse(data);
      if (Array.isArray(loadedWallets)) {
      wallets = loadedWallets;
      console.log('تم تحميل المحافظ من الملف:', wallets);
    } else {
      console.error('محتوى ملف المحافظ غير صالح. يجب أن يكون مصفوفة.');
      wallets = [];
      }
    }
  } catch (error) {
  console.error('خطأ في تحميل المحافظ:', error);
  wallets = [];
}

// Save wallets to file
function saveWallets() {
  try {
    if (!Array.isArray(wallets)) {
      console.error('خطأ: المحافظ ليست مصفوفة. إعادة تهيئة المصفوفة.');
      wallets = [];
    }
    fs.writeFileSync('wallets.json', JSON.stringify(wallets, null, 2));
    console.log('تم حفظ المحافظ:', wallets);
  } catch (error) {
    console.error('خطأ في حفظ المحافظ:', error);
  }
}

// Utility functions
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatSol(lamports) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9);
}

function formatDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleString('ar-SA');
}

// Add at the top of the file, after other variable declarations
let lastRenamedWalletAddress = null;
let checkInterval = 1 * 60 * 1000; // 1 minute
let checkIntervalId = null;

// Main menu keyboard
function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📋 عرض المحافظ', callback_data: 'list_wallets' },
        { text: '🔍 فحص المعاملات', callback_data: 'check_transactions' }
      ],
      [
        { text: '➕ إضافة محفظة', callback_data: 'add_wallet' },
        { text: '❌ إزالة محفظة', callback_data: 'remove_wallet' }
      ],
      [
        { text: 'ℹ️ معلومات محفظة', callback_data: 'wallet_info' },
        { text: '✏️ تغيير اسم محفظة', callback_data: 'rename_wallet' }
      ],
      [
        { text: '⚙️ تغيير الحد الأدنى', callback_data: 'change_min_amount' },
        { text: '⏱️ تغيير فترة الفحص', callback_data: 'change_interval' }
      ],
      [
        { text: '❓ المساعدة', callback_data: 'help' }
      ]
    ]
  };
}

// Telegram command handlers
bot.onText(/\/start/, async (msg) => {
  if (!isUserAllowed(msg.from.id)) {
    bot.sendMessage(msg.chat.id, 'عذراً، غير مصرح لك باستخدام هذا البوت.');
    return;
  }
  
  const message = 'مرحباً بك في بوت مراقبة محافظ سولانا! 🚀\n\n' +
    'استخدم الأزرار أدناه للتحكم في البوت:';
  
  bot.sendMessage(msg.chat.id, message, { reply_markup: getMainMenuKeyboard() });
});

// Callback query handler
bot.on('callback_query', async (callbackQuery) => {
  if (!isUserAllowed(callbackQuery.from.id)) return;
  
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;

  switch (data) {
    case 'list_wallets':
      if (wallets.length === 0) {
        bot.sendMessage(chatId, 'لا توجد محافظ قيد المراقبة حالياً.');
        return;
      }
      
      const message = '📋 المحافظ قيد المراقبة:\n\n' + 
        wallets.map((wallet, index) => `${index + 1}. ${wallet.name} (${wallet.address})`).join('\n');
      
      bot.sendMessage(chatId, message);
      break;

    case 'check_transactions':
      if (wallets.length === 0) {
        bot.sendMessage(chatId, 'لا توجد محافظ لفحص معاملاتها.');
        return;
      }
      
      const checkKeyboard = {
        inline_keyboard: [
          [{ text: '🔍 فحص جميع المحافظ', callback_data: 'check_all_wallets' }],
          ...wallets.map((wallet, index) => [{
            text: `${index + 1}. ${wallet.name} (${wallet.address.substring(0, 8)}...)`,
            callback_data: `check_${wallet.address}`
          }])
        ]
      };
      
      bot.sendMessage(chatId, 'اختر محفظة لفحص معاملاتها:', { reply_markup: checkKeyboard });
      break;

    case 'add_wallet':
      bot.sendMessage(chatId, 'الرجاء إدخال عنوان المحفظة التي تريد إضافتها:', {
        reply_markup: {
          force_reply: true
        }
      });
      break;

    case 'remove_wallet':
      if (wallets.length === 0) {
        bot.sendMessage(chatId, 'لا توجد محافظ لإزالتها.');
      return;
    }
    
      const removeKeyboard = {
        inline_keyboard: wallets.map((wallet, index) => [{
          text: `${index + 1}. ${wallet.name} (${wallet.address})`,
          callback_data: `remove_${wallet.address}`
        }])
      };
      
      bot.sendMessage(chatId, 'اختر محفظة لإزالتها:', { reply_markup: removeKeyboard });
      break;

    case 'wallet_info':
      if (wallets.length === 0) {
        bot.sendMessage(chatId, 'لا توجد محافظ لعرض معلوماتها.');
        return;
      }

      const infoKeyboard = {
        inline_keyboard: wallets.map((wallet, index) => [{
          text: `${index + 1}. ${wallet.name} (${wallet.address})`,
          callback_data: `info_${wallet.address}`
        }])
      };
      
      bot.sendMessage(chatId, 'اختر محفظة لعرض معلوماتها:', { reply_markup: infoKeyboard });
      break;

    case 'rename_wallet':
      if (wallets.length === 0) {
        bot.sendMessage(chatId, 'لا توجد محافظ لإعادة تسميتها.');
      return;
    }
    
      const renameKeyboard = {
        inline_keyboard: wallets.map((wallet, index) => [{
          text: `${index + 1}. ${wallet.name} (${wallet.address})`,
          callback_data: `rename_${wallet.address}`
        }])
      };
      
      bot.sendMessage(chatId, 'اختر محفظة لإعادة تسميتها:', { reply_markup: renameKeyboard });
      break;

    case 'change_min_amount':
      const minAmountKeyboard = {
        inline_keyboard: [
          [
            { text: '0.1 SOL', callback_data: 'min_0.1' },
            { text: '0.5 SOL', callback_data: 'min_0.5' },
            { text: '1 SOL', callback_data: 'min_1' }
          ],
          [
            { text: '5 SOL', callback_data: 'min_5' },
            { text: '10 SOL', callback_data: 'min_10' },
            { text: '50 SOL', callback_data: 'min_50' }
          ],
          [
            { text: '100 SOL', callback_data: 'min_100' },
            { text: 'قيمة مخصصة', callback_data: 'min_custom' }
          ]
        ]
      };
      
      bot.sendMessage(chatId, `الحد الأدنى الحالي: ${minSolAmount} SOL\n\nاختر قيمة جديدة أو قم بتحديد قيمة مخصصة:`, {
        reply_markup: minAmountKeyboard
      });
      break;

    case 'change_interval':
      const currentMinutes = checkInterval / (60 * 1000);
      bot.sendMessage(chatId, `فترة الفحص الحالية هي ${currentMinutes} دقيقة. الرجاء إدخال عدد الدقائق الجديد:`, {
        reply_markup: {
          force_reply: true
        }
      });
      break;

    case 'help':
      const helpMessage = 'مرحباً بك في بوت مراقبة محافظ سولانا! 🚀\n\n' +
        'استخدم الأزرار أدناه للتحكم في البوت:\n\n' +
        '📋 عرض المحافظ - عرض قائمة المحافظ المراقبة\n' +
        '🔍 فحص المعاملات - فحص جميع المحافظ للمعاملات الأخيرة\n' +
        '➕ إضافة محفظة - إضافة محفظة جديدة للمراقبة\n' +
        '❌ إزالة محفظة - إزالة محفظة من المراقبة\n' +
        'ℹ️ معلومات محفظة - عرض معلومات مفصلة عن محفظة\n' +
        '✏️ تغيير اسم محفظة - تغيير اسم محفظة\n' +
        '⚙️ تغيير الحد الأدنى - تغيير الحد الأدنى للمعاملات التي تتجاوزه\n' +
        '⏱️ تغيير فترة الفحص - تغيير فترة الفحص الدوري\n' +
        '❓ المساعدة - عرض هذه الرسالة';
      
      bot.sendMessage(chatId, helpMessage, { reply_markup: getMainMenuKeyboard() });
      break;

    case 'min_0.1':
    case 'min_0.5':
    case 'min_1':
    case 'min_5':
    case 'min_10':
    case 'min_50':
    case 'min_100':
    case 'min_custom':
      const amountValue = data.replace('min_', '');
      
      if (amountValue === 'custom') {
        bot.sendMessage(chatId, `الحد الأدنى الحالي هو ${minSolAmount} SOL. الرجاء إدخال قيمة جديدة:`, {
          reply_markup: {
            force_reply: true
          }
        });
      } else {
        const newAmount = parseFloat(amountValue);
        if (!isNaN(newAmount)) {
          minSolAmount = newAmount;
          bot.answerCallbackQuery(callbackQuery.id, {
            text: `✅ تم تغيير الحد الأدنى إلى ${minSolAmount} SOL`,
            show_alert: true
          });
          
          // تحدية الرسالة بالقيمة الجديدة
          const updatedKeyboard = {
            inline_keyboard: [
              [
                { text: '0.1 SOL', callback_data: 'min_0.1' },
                { text: '0.5 SOL', callback_data: 'min_0.5' },
                { text: '1 SOL', callback_data: 'min_1' }
              ],
              [
                { text: '5 SOL', callback_data: 'min_5' },
                { text: '10 SOL', callback_data: 'min_10' },
                { text: '50 SOL', callback_data: 'min_50' }
              ],
              [
                { text: '100 SOL', callback_data: 'min_100' },
                { text: 'قيمة مخصصة', callback_data: 'min_custom' }
              ],
              [
                { text: 'العودة للقائمة الرئيسية', callback_data: 'main_menu' }
              ]
            ]
          };
          
          bot.editMessageText(`الحد الأدنى الحالي: ${minSolAmount} SOL\n\nاختر قيمة جديدة أو قم بتحديد قيمة مخصصة:`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: updatedKeyboard
          });
        }
      }
      break;

    case 'main_menu':
      // العودة للقائمة الرئيسية
      bot.editMessageText('مرحباً بك في بوت مراقبة محافظ سولانا! 🚀\n\n' +
        'استخدم الأزرار أدناه للتحكم في البوت:', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: getMainMenuKeyboard()
        });
      break;

    default:
      if (data.startsWith('remove_')) {
        const walletAddress = data.replace('remove_', '');
        const wallet = wallets.find(w => w.address === walletAddress);
        wallets = wallets.filter(w => w.address !== walletAddress);
        saveWallets();
        bot.answerCallbackQuery(callbackQuery.id, {
          text: `تمت إزالة المحفظة ${wallet.name} (${walletAddress}) من المراقبة.`,
          show_alert: true
        });
      } else if (data.startsWith('info_')) {
        const walletAddress = data.replace('info_', '');
        try {
          const profile = await getWalletProfile(walletAddress);
          const solscanInfo = await getSolscanWalletInfo(walletAddress);
          const wallet = wallets.find(w => w.address === walletAddress);
          
          const message = `📊 معلومات المحفظة ${wallet ? wallet.name : walletAddress}:\n\n` +
            `العنوان: ${walletAddress}\n` +
            `الرصيد: ${formatSol(solscanInfo.lamports)} SOL\n` +
            `تاريخ الإنشاء: ${formatDate(solscanInfo.createdAt)}\n` +
            `عدد المعاملات: ${numberWithCommas(solscanInfo.transactionCount)}\n` +
            `عدد NFTs: ${profile.nftCount}\n` +
            `عدد التوكنز: ${profile.tokenCount}`;
          
          bot.sendMessage(chatId, message);
        } catch (error) {
          bot.sendMessage(chatId, '❌ خطأ في جلب معلومات المحفظة.');
        }
      } else if (data.startsWith('rename_')) {
        const walletAddress = data.replace('rename_', '');
        lastRenamedWalletAddress = walletAddress; // Store the wallet address being renamed
        bot.sendMessage(chatId, 'الرجاء إدخال الاسم الجديد للمحفظة:', {
          reply_markup: {
            force_reply: true
          }
        });
      } else if (data === 'check_all_wallets') {
        const checkingMsg = await bot.sendMessage(chatId, '🔍 جاري فحص جميع المحافظ للمعاملات الأخيرة...');
        const results = await checkAllWallets();
        const totalNotifications = results.reduce((total, result) => total + result.notifications, 0);
        
        let resultMsg = '✅ تم الانتهاء من الفحص!\n\n';
        resultMsg += `تم فحص ${wallets.length} محفظة.\n`;
        resultMsg += `تم إرسال ${totalNotifications} إشعار.\n\n`;
        
        if (totalNotifications > 0) {
          resultMsg += 'المحافظ التي تم إرسال إشعارات لها:\n';
          results.forEach(result => {
            if (result.notifications > 0) {
              resultMsg += `- ${result.walletName}: ${result.notifications} إشعار\n`;
            }
          });
        } else {
          resultMsg += 'لم يتم العثور على معاملات تتجاوز الحد الأدنى.';
        }
        
        await bot.editMessageText(resultMsg, { chat_id: chatId, message_id: checkingMsg.message_id });
      } else if (data.startsWith('check_')) {
        const walletAddress = data.replace('check_', '');
        const wallet = wallets.find(w => w.address === walletAddress);
        const walletName = wallet ? wallet.name : walletAddress.substring(0, 8) + '...';
        
        const checkingMsg = await bot.sendMessage(chatId, `🔍 جاري فحص المحفظة ${walletName} للمعاملات الأخيرة...`);
        const notifications = await checkWalletTransactions(walletAddress);
        
        let resultMsg = '✅ تم الانتهاء من الفحص!\n\n';
        if (notifications > 0) {
          resultMsg += `تم إرسال ${notifications} إشعار للمعاملات التي تتجاوز ${minSolAmount} SOL.`;
        } else {
          resultMsg += `لم يتم العثور على معاملات تتجاوز ${minSolAmount} SOL.`;
        }
        
        await bot.editMessageText(resultMsg, { chat_id: chatId, message_id: checkingMsg.message_id });
    }
  }
});

// Handle text messages for adding and renaming wallets
bot.on('message', async (msg) => {
  if (!isUserAllowed(msg.from.id)) return;
  
  // Skip if the message is a command
  if (msg.text && msg.text.startsWith('/')) return;
  
  // Handle reply to add wallet message
  if (msg.reply_to_message && msg.reply_to_message.text === 'الرجاء إدخال عنوان المحفظة التي تريد إضافتها:') {
    const walletAddress = msg.text.trim();
    try {
      new PublicKey(walletAddress);
      if (wallets.some(w => w.address === walletAddress)) {
        bot.sendMessage(msg.chat.id, 'هذه المحفظة قيد المراقبة بالفعل.');
        return;
      }
      
      const newWallet = {
        address: walletAddress,
        name: `محفظة ${wallets.length + 1}`
      };
      
      wallets.push(newWallet);
      saveWallets();
      bot.sendMessage(msg.chat.id, `✅ تمت إضافة المحفظة ${walletAddress} باسم "${newWallet.name}".\nيمكنك تغيير الاسم باستخدام زر "✏️ تغيير اسم محفظة"`, {
        reply_markup: getMainMenuKeyboard()
      });
    } catch (error) {
      bot.sendMessage(msg.chat.id, '❌ عنوان محفظة غير صالح. الرجاء إدخال عنوان محفظة سولانا صالح.');
    }
  }
  
  // Handle reply to rename wallet message
  if (msg.reply_to_message && msg.reply_to_message.text === 'الرجاء إدخال الاسم الجديد للمحفظة:') {
    const newName = msg.text.trim();
    if (!newName) {
      bot.sendMessage(msg.chat.id, 'الرجاء إدخال اسم صالح.');
      return;
    }
    
    // Find the last wallet that was being renamed
    const lastRenamedWallet = wallets.find(w => w.address === lastRenamedWalletAddress);
    if (lastRenamedWallet) {
      lastRenamedWallet.name = newName;
      saveWallets();
      bot.sendMessage(msg.chat.id, `✅ تم تغيير اسم المحفظة إلى "${newName}"`, {
        reply_markup: getMainMenuKeyboard()
      });
    }
  }
  
  // Handle reply to change min amount message
  else if (msg.reply_to_message && msg.reply_to_message.text.startsWith('الحد الأدنى الحالي هو')) {
    const newAmount = parseFloat(msg.text.trim());
    if (isNaN(newAmount) || newAmount <= 0) {
      bot.sendMessage(msg.chat.id, 'الرجاء إدخال قيمة صالحة أكبر من 0.');
      return;
    }
    
    minSolAmount = newAmount;
    bot.sendMessage(msg.chat.id, `✅ تم تغيير الحد الأدنى إلى ${minSolAmount} SOL.`, {
      reply_markup: getMainMenuKeyboard()
    });
  }
  
  // Handle reply to change interval message
  else if (msg.reply_to_message && msg.reply_to_message.text.startsWith('فترة الفحص الحالية هي')) {
    const newMinutes = parseInt(msg.text.trim());
    if (isNaN(newMinutes) || newMinutes < 1) {
      bot.sendMessage(msg.chat.id, 'الرجاء إدخال عدد دقائق صالح أكبر من 0.');
      return;
    }
    
    checkInterval = newMinutes * 60 * 1000;
    
    // Restart the periodic checking with the new interval
    if (checkIntervalId) {
      clearInterval(checkIntervalId);
    }
    startPeriodicChecking();
    
    bot.sendMessage(msg.chat.id, `✅ تم تغيير فترة الفحص إلى ${newMinutes} دقيقة.`, {
      reply_markup: getMainMenuKeyboard()
    });
  }
});

// Helper function to check if user is allowed
function isUserAllowed(userId) {
  return allowedUsers.length === 0 || allowedUsers.includes(userId.toString());
}

// Wallet monitoring functions
async function getWalletProfile(walletAddress) {
  try {
    const response = await axios.get(`${heliusApiUrl}/addresses/${walletAddress}/balances?api-key=${heliusApiKey}`);
    return {
      nftCount: response.data.nft?.length || 0,
      tokenCount: response.data.tokens?.length || 0
    };
  } catch (error) {
    console.error('خطأ في جلب معلومات المحفظة:', error);
    return { nftCount: 0, tokenCount: 0 };
  }
}

async function getSolscanWalletInfo(walletAddress) {
  try {
    const response = await axios.get(`https://api.solscan.io/account?address=${walletAddress}`, {
      headers: {
        'token': solscanApiKey
      }
    });
    return {
      lamports: response.data.lamports || 0,
      createdAt: response.data.createdAt || 0,
      transactionCount: response.data.transactionCount || 0
    };
  } catch (error) {
    console.error('خطأ في جلب معلومات المحفظة من Solscan:', error);
    return { lamports: 0, createdAt: 0, transactionCount: 0 };
  }
}

// إضافة دالة لحساب عمر المحفظة بالأيام والساعات
function calculateWalletAge(createdAtTimestamp) {
  if (!createdAtTimestamp) return '0 يوم و 0 ساعة';
  
  const now = Date.now() / 1000;
  const createdAt = parseInt(createdAtTimestamp);
  const ageInSeconds = now - createdAt;
  
  // تحويل الثواني إلى أيام وساعات
  const days = Math.floor(ageInSeconds / (24 * 60 * 60));
  const hours = Math.floor((ageInSeconds % (24 * 60 * 60)) / (60 * 60));
  
  return `${days || 0} يوم و ${hours || 0} ساعة`;
}

// تعديل دالة checkWalletTransactions لاستخدام عمر المحفظة
async function checkWalletTransactions(walletAddress) {
  try {
    console.log(`فحص المحفظة: ${walletAddress}`);
    const response = await axios.get(`${heliusApiUrl}/addresses/${walletAddress}/transactions?api-key=${heliusApiKey}`);
    if (!response.data || !Array.isArray(response.data)) {
      console.error(`بيانات المعاملات غير صالحة للمحفظة ${walletAddress}:`, response.data);
      return 0;
    }
    
    const transactions = response.data;
    console.log(`تم العثور على ${transactions.length} معاملة للمحفظة ${walletAddress}`);
    
    // طباعة أول معاملة كاملة لفهم بنية البيانات
    if (transactions.length > 0) {
      console.log('نموذج معاملة كاملة:');
      console.log(JSON.stringify(transactions[0], null, 2));
    }
    
    let notificationsSent = 0;
    
    for (const tx of transactions) {
      try {
        console.log(`فحص المحفظة: ${tx.signature || 'بدون توقيع'}, النوع: ${tx.type || 'غير معروف'}`);
        
        // استخراج المبلغ من الوصف إذا كان متاحًا
        let amountInSol = 0;
        let descriptionMatch = null;
        
        if (tx.description) {
          descriptionMatch = tx.description.match(/transferred ([0-9.]+) SOL to/);
          if (descriptionMatch && descriptionMatch[1]) {
            amountInSol = parseFloat(descriptionMatch[1]);
            console.log(`تم استخراج المبلغ من الوصف: ${amountInSol} SOL`);
          }
        }
        
        // استخدام tx.amount إذا كان متاحًا ولم نستخرج من الوصف
        if (amountInSol === 0 && tx.amount !== undefined) {
          amountInSol = tx.amount / LAMPORTS_PER_SOL;
          console.log(`تم استخراج المبلغ من tx.amount: ${amountInSol} SOL`);
        }
        
        console.log(`المبلغ النهائي: ${amountInSol} SOL، الحد الأدنى: ${minSolAmount} SOL`);
        
        // اختبار المعاملة لإرسال الإشعار
        if (tx.type === 'TRANSFER' && amountInSol >= minSolAmount) {
          console.log(`تم العثور على معاملة تتجاوز الحد الأدنى: ${amountInSol.toFixed(9)} SOL`);
          
          const fromAddress = tx.fromAddress || tx.owner || walletAddress;
          const toAddress = tx.toAddress || '';
          
          const wallet = wallets.find(w => w.address === walletAddress);
          const walletName = wallet ? wallet.name : walletAddress.substring(0, 8) + '...';
          
          // استخراج المستلم من وصف المعاملة إذا كان متاحاً
          let receiverAddress = toAddress;
          if (tx.description) {
            const receiverMatch = tx.description.match(/transferred [0-9.]+ SOL to ([A-Za-z0-9]+)/);
            if (receiverMatch && receiverMatch[1]) {
              receiverAddress = receiverMatch[1];
              console.log(`تم استخراج عنوان المستلم من الوصف: ${receiverAddress}`);
            }
          }
          
          // الحصول على معلومات المحفظة المستلمة من Solscan
          try {
            console.log(`جلب معلومات المحفظة المستلمة: ${receiverAddress}`);
            const solscanInfo = await getSolscanWalletInfo(receiverAddress);
            const walletAge = calculateWalletAge(solscanInfo.createdAt);
            
            const message = `🚨 *معاملة جديدة!* 🚨\n\n` +
              `👛 *المحفظة:* ${walletName}\n` +
              `💰 *المبلغ:* \`${amountInSol.toFixed(4)} SOL\`\n` +
              `📥 *المستلم:* \`${receiverAddress}\`\n\n` +
              `🔍 [فحص المحفظة](https://solscan.io/account/${receiverAddress})`;
            
            // Send notification to all allowed users
            console.log(`إرسال إشعار للمستخدمين المسموح لهم: ${allowedUsers.join(', ')}`);
            for (const userId of allowedUsers) {
              try {
                await bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
                console.log(`تم إرسال الإشعار للمستخدم ${userId}`);
                notificationsSent++;
              } catch (error) {
                console.error(`خطأ في إرسال الإشعار للمستخدم ${userId}:`, error.message);
              }
            }
          } catch (solscanError) {
            console.error(`خطأ في جلب معلومات المحفظة من Solscan:`, solscanError.message);
            // إرسال الإشعار بدون معلومات عمر المحفظة
            const message = `🚨 *معاملة جديدة!* 🚨\n\n` +
              `👛 *المحفظة:* ${walletName}\n` +
              `💰 *المبلغ:* \`${amountInSol.toFixed(4)} SOL\`\n` +
              `📥 *المستلم:* \`${receiverAddress}\`\n\n` +
              `🔍 [فحص المحفظة](https://solscan.io/account/${receiverAddress})`;
            
            // Send notification to all allowed users
            console.log(`إرسال إشعار للمستخدمين المسموح لهم: ${allowedUsers.join(', ')}`);
            for (const userId of allowedUsers) {
              try {
                await bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
                console.log(`تم إرسال الإشعار للمستخدم ${userId}`);
                notificationsSent++;
              } catch (error) {
                console.error(`خطأ في إرسال الإشعار للمستخدم ${userId}:`, error.message);
              }
            }
          }
    } else {
          console.log(`تم تجاوز المعاملة، المبلغ أقل من الحد الأدنى أو ليست تحويل سولانا`);
        }
      } catch (txError) {
        console.error(`خطأ في معالجة المعاملة:`, txError.message);
        continue; // Skip this transaction and continue with the next one
      }
    }
    
    console.log(`تم فحص ${transactions.length} معاملة وإرسال ${notificationsSent} إشعار`);
    return notificationsSent;
  } catch (error) {
    console.error(`خطأ في فحص معاملات المحفظة ${walletAddress}:`, error.message);
    return 0;
  }
}

async function checkAllWallets() {
  console.log('بدء فحص جميع المحافظ...');
  const results = [];
  
  for (const wallet of wallets) {
    try {
      console.log(`فحص المحفظة: ${wallet.name} (${wallet.address})`);
      const notifications = await checkWalletTransactions(wallet.address);
      results.push({
        walletAddress: wallet.address,
        walletName: wallet.name,
        notifications: notifications
      });
      
      await delay(1000); // تأخير 1 ثانية بين كل محفظة لتجنب تجاوز حدود API
  } catch (error) {
      console.error(`خطأ في فحص المحفظة ${wallet.address}:`, error.message);
      results.push({
        walletAddress: wallet.address,
        walletName: wallet.name,
        notifications: 0,
        error: error.message
      });
      continue; // Skip this wallet and continue with the next one
    }
  }
  
  console.log('تم الانتهاء من فحص جميع المحافظ');
  console.log('نتائج الفحص:', results);
  return results;
}

function startPeriodicChecking() {
  // فحص فوري عند بدء التشغيل
  checkAllWallets();
  
  // فحص دوري حسب الفترة المحددة
  checkIntervalId = setInterval(checkAllWallets, checkInterval);
  console.log(`تم بدء المراقبة الدورية للمحافظ كل ${checkInterval / (60 * 1000)} دقيقة`);
}

// Start the bot
console.log('جاري بدء تشغيل البوت...');
startPeriodicChecking();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});

app.get('/', (req, res) => {
  res.send('¡Bot activo!');
});