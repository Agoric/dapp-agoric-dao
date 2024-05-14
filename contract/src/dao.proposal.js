// @ts-check
import { allValues } from './objectTools.js';
import {
  AmountMath,
  installContract,
  startContract,
} from './platform-goals/start-contract.js';

const { Fail } = assert;

const contractName = 'simpleDao';

export const makeTerms = (daoTokensBrand, daoTokensUnits, membershipBrand) => {
  return {
    DaoTerms: {
      DaoToken: AmountMath.make(daoTokensBrand, daoTokensUnits),
      Membership: AmountMath.make(membershipBrand, 10n),
    }
  };
};


/**
 * Core eval script to start contract
 *
 * @param {BootstrapPowers } permittedPowers
 * @param {*} config
 *
 * @typedef {{
 *   brand: PromiseSpaceOf<{ DaoToken: Brand }>;
 *   issuer: PromiseSpaceOf<{ DaoToken: Issuer }>;
 *   instance: PromiseSpaceOf<{ Dao: Instance }>
 * }} DaoSpace
 */
export const startDaoContract = async (
  permittedPowers,
  config,
) => {
  console.log('core eval for', contractName);
  const {
    // must be supplied by caller or template-replaced
    bundleID = Fail`no bundleID`,
  } = config?.options?.[contractName] ?? {};

  const installation = await installContract(permittedPowers, {
    name: contractName,
    bundleID,
  });

  const ist = await allValues({
    brand: permittedPowers.brand.consume.IST,
    issuer: permittedPowers.issuer.consume.IST,
  });

  //basic terms
  const terms = makeTerms("DummyDao", 100n, "DummyMembership");

  await startContract(permittedPowers, {
    name: contractName,
    startArgs: {
      installation,
      terms,
    },
    issuerNames: ['DummyDao', 'DummyMembership'],
  });

  console.log(contractName, '(re)started');
};

// need more details on permit
/** @type { import("@agoric/vats/src/core/lib-boot").BootstrapManifestPermit } */
export const permit = harden({
  consume: {
    agoricNames: true,
    brandAuxPublisher: true,
    startUpgradable: true, 
    zoe: true,
    board: true,
    chainStorage: true,
  },
  installation: {
    consume: { [contractName]: true },
    produce: { [contractName]: true },
  },
  instance: { produce: { [contractName]: true } },
  // permitting brands
  issuer: { consume: { IST: true, Membership: true, DaoToken: true }, produce: { Membership: true, DaoToken: true} },
  brand: { consume: { IST: true, Membership: true, DaoToken: true }, produce: { Membership: true, DaoToken: true} },
});

export const main = startDaoContract;
