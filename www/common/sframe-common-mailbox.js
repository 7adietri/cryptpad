define([
    'jquery',
    '/common/common-util.js',
    '/common/common-interface.js',
    '/common/common-ui-elements.js',
    '/common/notifications.js',
    '/common/hyperscript.js',
    '/customize/messages.js',
], function ($, Util, UI, UIElements, Notifications, h, Messages) {
    var Mailbox = {};

    Mailbox.create = function (Common) {
        var mailbox = Common.mailbox;
        var sframeChan = Common.getSframeChannel();

        var execCommand = function (cmd, data, cb) {
            sframeChan.query('Q_MAILBOX_COMMAND', {
                cmd: cmd,
                data: data
            }, function (err, obj) {
                if (err) { return void cb({error: err}); }
                cb(obj);
            });
        };

        var history = {};

        var removeFromHistory = function (type, hash) {
            if (!history[type]) { return; }
            history[type] = history[type].filter(function (obj) {
                return obj.hash !== hash;
            });
        };

        mailbox.sendTo = function (type, content, user) {
            execCommand('SENDTO', {
                type: type,
                msg: content,
                user: user
            }, function (err, obj) {
                if (err || (obj && obj.error)) { return void console.error(err || obj.error); }
            });
        };

        // UI

        var formatData = function (data) {
            return JSON.stringify(data.content.msg.content);
        };
        var createElement = function (data) {
            var notif;
            var dismissIcon = h('span.fa.fa-times');
            var dismiss = h('div.cp-notification-dismiss', {
                title: Messages.notifications_dismiss
            }, dismissIcon);
            dismiss.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                mailbox.dismiss(data, function (err) {
                    if (err) { return void console.error(err); }
                    /*if (notif && notif.parentNode) {
                        try {
                            notif.parentNode.removeChild(notif);
                        } catch (e) { console.error(e); }
                    }*/
                });
            });
            notif = h('div.cp-notification', {
                'data-hash': data.content.hash
            }, [
                h('div.cp-notification-content', h('p', formatData(data))),
                dismiss
            ]);
            return notif;
        };


        var onViewedHandlers = [];
        var onMessageHandlers = [];

        onViewedHandlers.push(function (data) {
            var hash = data.hash.replace(/"/g, '\\\"');
            var $notif = $('.cp-notification[data-hash="'+hash+'"]');
            if ($notif.length) {
                $notif.remove();
            }
        });

        // Call the onMessage handlers
        var pushMessage = function (data, handler) {
            var todo = function (f) {
                try {
                    var el;
                    if (data.type === 'notifications') {
                        el = createElement(data);
                        Notifications.add(Common, data, el);
                    }
                    f(data, el);
                } catch (e) {
                    console.error(e);
                }
            };
            if (typeof (handler) === "function") {
                return void todo(handler);
            }
            onMessageHandlers.forEach(todo);
        };

        var onViewed = function (data) {
            // data = { type: 'type', hash: 'hash' }
            onViewedHandlers.forEach(function (f) {
                try {
                    f(data);
                    if (data.type === 'notifications') {
                        Notifications.remove(Common, data);
                    }
                } catch (e) {
                    console.error(e);
                }
            });
            removeFromHistory(data.type, data.hash);
        };

        var onMessage = function (data) {
            // data = { type: 'type', content: {msg: 'msg', hash: 'hash'} }
            console.log(data.type, data.content);
            pushMessage(data);
            if (!history[data.type]) { history[data.type] = []; }
            history[data.type].push(data.content);
        };

        mailbox.dismiss = function (data, cb) {
            var dataObj = {
                hash: data.content.hash,
                type: data.type
            };
            execCommand('DISMISS', dataObj, function (obj) {
                if (obj && obj.error) { return void cb(obj.error); }
                onViewed(dataObj);
                cb();
            });
        };

        var subscribed = false;

        // Get all existing notifications + the new ones when they come
        mailbox.subscribe = function (types, cfg) {
            if (!subscribed) {
                execCommand('SUBSCRIBE', null, function () {});
                subscribed = true;
            }
            if (typeof(cfg.onViewed) === "function") {
                onViewedHandlers.push(function (data) {
                    if (types.indexOf(data.type) === -1) { return; }
                    cfg.onViewed(data);
                });
            }
            if (typeof(cfg.onMessage) === "function") {
                onMessageHandlers.push(function (data, el) {
                    if (types.indexOf(data.type) === -1) { return; }
                    cfg.onMessage(data, el);
                });
            }
            Object.keys(history).forEach(function (type) {
                if (types.indexOf(type) === -1) { return; }
                history[type].forEach(function (data) {
                    pushMessage({
                        type: type,
                        content: data
                    }, cfg.onMessage);
                });
            });
        };

        var historyState = false;
        var onHistory = function () {};
        mailbox.getMoreHistory = function (type, count, lastKnownHash, cb) {
            if (historyState) { return void cb("ALREADY_CALLED"); }
            historyState = true;
            var txid = Util.uid();
            execCommand('LOAD_HISTORY', {
                type: type,
                count: count,
                txid: txid,
                lastKnownHash: lastKnownHash
            }, function (err, obj) {
                if (obj && obj.error) { console.error(obj.error); }
            });
            var messages = [];
            onHistory = function (data) {
                if (data.txid !== txid) { return; }
                if (data.complete) {
                    onHistory = function () {};
                    cb(null, messages);
                    historyState = false;
                    return;
                }
                messages.push({
                    type: type,
                    content: {
                        msg: data.message,
                        time: data.time,
                        hash: data.hash
                    }
                });
            };
        };

        // CHANNEL WITH WORKER

        sframeChan.on('EV_MAILBOX_EVENT', function (obj) {
            // obj = { ev: 'type', data: obj }
            var ev = obj.ev;
            var data = obj.data;
            if (ev === 'HISTORY') {
                return void onHistory(data);
            }
            if (ev === 'MESSAGE') {
                return void onMessage(data);
            }
            if (ev === 'VIEWED') {
                return void onViewed(data);
            }
        });

        return mailbox;
    };

    return Mailbox;
});


