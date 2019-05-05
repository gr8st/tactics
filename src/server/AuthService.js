import uuid from 'uuid/v4';
import jwt from 'jsonwebtoken';

import config from 'config/server.js';
import Service from 'server/Service.js';
import ServerError from 'server/Error.js';
import adapterFactory from 'data/adapterFactory.js';
import Player from 'models/Player.js';

const dataAdapter = adapterFactory();

class AuthService extends Service {
  constructor() {
    super({
      name: 'auth',

      // Session data for each client.
      sessions: new Map(),
    });
  }

  dropClient(client) {
    super.dropClient(client);

    this.sessions.delete(client);
  }

  /*****************************************************************************
   * Socket Message Event Handlers
   ****************************************************************************/
  onAuthorize(client, { token }) {
    let session = this.sessions.get(client.id);
    let claims = jwt.verify(token, config.publicKey);

    this.sessions.set(client.id, { token });
  }

  onRegisterRequest(client, playerData) {
    let session = this.sessions.get(client.id) || {};
    let now = new Date();

    // An authorized player cannot register an account.
    if (session.token) return;

    /*
     * More than one client may be registered to a given IP address, e.g.
     * two mobile phones on the same wireless network.  Just don't register
     * more than one account per minute to protect against DoS.
     */
    this.throttle(client.address, 'register', 1, 60);

    let deviceData = {
      addresses: new Map([[client.address, now]]),
      agents: new Map([[client.agent, now]]),
    };

    let player = dataAdapter.createPlayer(playerData);
    let device = player.addDevice(deviceData);
    let token  = player.createToken(device.id);

    dataAdapter.savePlayer(player);

    return token;
  }

  /*
   * To refresh a token, a couple things must be true:
   *   1) It must be a verified JWT.  It may be expired, however.
   *   2) The device must be associated with the token.
   */
  onRefreshTokenRequest(client, token) {
    let session = this.sessions.get(client.id) || {};
    let now = new Date();

    // An authorized player does not have to provide the token.
    if (session.token)
      token = session.token;

    let claims = jwt.verify(token, config.publicKey, {
      ignoreExpiration: true,
    });
    // Get the player here to make sure it still exists.
    let player = dataAdapter.getPlayer(claims.sub);
    let newToken;

    // Cowardly refuse to refresh a token less than 1 hour old.
    let diff = (now / 1000) - claims.iat;
    if (diff < 3600)
      newToken = token;
    else {
      let device = player.getDevice(claims.deviceId);
      if (!device)
        throw new ServerError(401, 'Device deleted');
      if (device.disabled)
        throw new ServerError(401, 'Device disabled');

      if (device.token !== token)
        throw new ServerError(401, 'Token revoked');

      /*
       * Maintain a history of addresses and agents on this device and the last
       * time they were used.  This information can be made available to the
       * account owner so that they can audit the security of their account.
       */
      device.addresses.set(client.address, now);
      device.agents.set(client.agent, now);

      newToken = player.createToken(device.id);
      dataAdapter.savePlayer(player);
    }

    return newToken;
  }

  /*
   * Save player profile data.  This results in generating a new token.
   *
   * Right now, the client must first register or refresh token first.
   */
  onSaveProfileRequest(client, profile) {
    let session = this.sessions.get(client.id) || {};
    if (!session.token)
      throw new ServerError(401, 'Authorization is required');

    let claims = jwt.verify(session.token, config.publicKey);
    let player = dataAdapter.getPlayer(claims.sub);
    player.update(profile);
    let newToken = player.createToken(claims.deviceId);
    dataAdapter.savePlayer(player);

    return newToken;
  }
}

// This class is a singleton
export default new AuthService();
