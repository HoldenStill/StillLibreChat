const express = require('express');
const { CacheKeys } = require('librechat-data-provider');
const { handleOpenRouterEndpointsRequest } = require('@librechat/api');
const { modelController } = require('~/server/controllers/ModelController');
const { requireJwtAuth } = require('~/server/middleware/');
const { getLogStores } = require('~/cache');

const router = express.Router();
router.get('/', requireJwtAuth, modelController);
router.get('/openrouter/endpoints', requireJwtAuth, (req, res) =>
  handleOpenRouterEndpointsRequest(req, res, {
    cache: getLogStores(CacheKeys.OPENROUTER_ENDPOINTS),
  }),
);

module.exports = router;
