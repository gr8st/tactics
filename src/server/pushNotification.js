/*
 * This function owns the details of how a push notification is sent.
 *
 * Right now, it makes the bad, if expedient, assumption that the push service
 * uses the same data store as the service pushing the notification.
 *
 * Ideally, it should call the push service to push a notification.
 */
import webpush from 'web-push';
import DebugLogger from 'debug';

import adapterFactory from 'data/adapterFactory.js';
import config from 'config/server.js';

const dataAdapter = adapterFactory();
const debug = DebugLogger('service:push');

export default (playerId, notification) => {
  let subscriptions = dataAdapter.getAllPushSubscriptions(playerId);
  if (subscriptions.length === 0) return Promise.resolve([]);

  debug(`${notification.type}: playerId=${playerId}`);

  let payload = JSON.stringify(notification);

  webpush.setVapidDetails(
    config.push.subject,
    config.push.publicKey,
    config.push.privateKey,
  );

  return Promise.all(
    subscriptions.map(s => webpush.sendNotification(s, payload))
  );
};
