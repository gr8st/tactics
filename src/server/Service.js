import DebugLogger from 'debug';

import ServerError from 'server/Error.js';
import emitter from 'utils/emitter.js';
import serializer from 'utils/serializer.js';

export default class Service {
  constructor(props) {
    Object.assign(this, props, {
      debug: DebugLogger('service:' + props.name),

      // Keys: Clients
      // Values: Action stats maps
      _throttles: new Map(),

      _validators: new Map(),
    });
  }

  /*
   * Client-facing service methods may have their inputs validated & normalized.
   * The input validation is a proprietary shorthand for defining tuple schemas.
   * The shorthand is converted to JSON Schemas for validation purposes.
   * The JSON Schemas are converted to code for normalization purposes.
   */
  setValidation(validation) {
    const validators = new Map();

    for (const messageType of Object.keys(validation)) {
      switch (messageType) {
        case 'authorize':
          const key = messageType;
          validators.set(key, serializer.makeValidator(validation.authorize));
          break;
        case 'request':
          for (const [ method, definition ] of Object.entries(validation.request)) {
            const key = `${messageType}:${method}`;
            validators.set(key, serializer.makeValidator(definition));
          }
          break;
        default:
          throw new Error('Unsupported message type');
      }
    }

    this._validators = validators;
  }
  validate(messageType, body) {
    const validators = this._validators;
    let validate;

    switch (messageType) {
      case 'authorize':
        validate = validators.get('authorize');
        if (validate)
          body.data = validate(body.data);
        break;
      case 'request':
        validate = validators.get(`request:${body.method}`);
        if (validate)
          body.args = validate(body.args);
        break;
    }
  }

  will(client, messageType, body) {
    this.validate(messageType, body);

    return true;
  }

  async cleanup() {
    return this.data.cleanup();
  }

  /*
   * Stubs to be implemented by subclasses
   */
  async getStatus() {
    return { data:await this.data.getStatus() };
  }
  dropClient() {
  }

  sendResponse(client, message, data) {
    let promise;
    if (data instanceof Promise)
      promise = data;
    else
      promise = Promise.resolve(data);

    return promise.then(d =>
      this.sendToClient(client, {
        type: message.type,
        id:   message.id,
        data: d,
      })
    );
  }
  sendErrorResponse(client, message, error) {
    let errorData = {
      code: error.code || 500,
      message: error.message,
    };

    return this.sendToClient(client, {
      type:  message.type,
      id:    message.id,
      error: errorData,
    });
  }

  /*
   * Call this method before taking a throttled action
   *  identifier: This could be the client object, address, or device ID.
   *  actionName: Human readable name of the client's action
   *  limit: The maximum number of times the client may perform the action.
   *  period: The period (in seconds) in which the limit applies.
   *
   * If the throttle limit is reached, an error is thrown.
   * 
   * TODO: This just throttles a single connection.  We also need throttling
   * on connections from a single client address.  This belongs outside the
   * service context.
   */
  throttle(identifier, actionName, limit = 3, period = 15) {
    if (!this._throttles.has(identifier))
      this._throttles.set(identifier, new Map());

    let actions = this._throttles.get(identifier);
    let actionKey = [actionName, limit, period].join('\0');

    if (!actions.has(actionKey))
      actions.set(actionKey, []);

    let actionHits = actions.get(actionKey);

    // Prune hits that are older than the period.
    let maxAge = new Date(new Date() - period*1000);
    while (actionHits[0] < maxAge)
      actionHits.shift();

    if (actionHits.length === limit)
      throw new ServerError(429, 'Too Many Requests: ' + actionName);

    actionHits.push(new Date());
  }
};

emitter(Service);
