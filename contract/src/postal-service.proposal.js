/**
 * @file core eval script* to start the postalService contract.
 *
 * * see rollup.config.mjs to make a script from this file.
 *
 * The `permit` export specifies the corresponding permit.
 */
// @ts-check

import { E } from '@endo/far';
import { fixHub } from './fixHub.js';
import {
  installContract,
  startContract,
} from './platform-goals/start-contract.js';
import { allValues } from './objectTools.js';

const { Fail } = assert;

const contractName = 'postalService';

/**
 * @param {BootstrapPowers} powers
 * @param {{ options?: { postalService: {
 *   bundleID: string;
 *   issuerNames?: string[];
 * }}}} [config]
 */
export const startPostalService = async (powers, config) => {
  const {
    consume: { namesByAddressAdmin, agoricNames },
  } = powers;
  const {
    // must be supplied by caller or template-replaced
    bundleID = Fail`no bundleID`,
    issuerNames = ['IST', 'Invitation', 'BLD', 'ATOM'],
  } = config?.options?.[contractName] ?? {};

  const installation = await installContract(powers, {
    name: contractName,
    bundleID,
  });

  const namesByAddress = await fixHub(namesByAddressAdmin);
  const terms = harden({ namesByAddress });

  const issuerKeywordRecord = await allValues(
    Object.fromEntries(
      issuerNames.map(n => [n, E(agoricNames).lookup('issuer', n)]),
    ),
  );

  await startContract(powers, {
    name: contractName,
    startArgs: { installation, issuerKeywordRecord, terms },
  });
};

export const manifest = /** @type {const} */ ({
  [startPostalService.name]: {
    consume: {
      agoricNames: true,
      namesByAddress: true,
      namesByAddressAdmin: true,
      startUpgradable: true,
      zoe: true,
    },
    installation: {
      produce: { postalService: true },
      consume: { postalService: true },
    },
    instance: {
      produce: { postalService: true },
    },
  },
});

export const permit = Object.values(manifest)[0];

export const main = startPostalService;
