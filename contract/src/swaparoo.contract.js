/** @file swap assets */
// @ts-check

import { M, matches, mustMatch } from '@endo/patterns';
import { E, Far } from '@endo/far';
import '@agoric/zoe/exported.js';
import { atomicRearrange } from '@agoric/zoe/src/contractSupport/atomicTransfer.js';
import '@agoric/zoe/src/contracts/exported.js';
import { AmountShape } from '@agoric/ertp/src/typeGuards.js';
import {
  InstanceHandleShape,
  InvitationShape,
} from '@agoric/zoe/src/typeGuards.js';
// deep imports to avoid bloating our bundle
import { ParamTypes } from '@agoric/governance/src/constants.js';
import { CONTRACT_ELECTORATE } from '@agoric/governance/src/contractGovernance/governParam.js';
import { handleParamGovernance } from '@agoric/governance/src/contractHelper.js';
import { makeCollectFeesInvitation } from './collectFees.js';
import { fixHub } from './fixHub.js';

/** @template [Slot=unknown] @typedef {import('@endo/marshal').Marshal<Slot>} Marshaller */

const { quote: q } = assert;

const makeNatAmountShape = (brand, min) =>
  harden({ brand, value: min ? M.gte(min) : M.nat() });

export const swapWithFee = (zcf, firstSeat, secondSeat, feeSeat, feeAmount) => {
  try {
    const { Fee: _, ...firstGive } = firstSeat.getProposal().give;

    atomicRearrange(
      zcf,
      harden([
        [firstSeat, secondSeat, firstGive],
        [secondSeat, firstSeat, secondSeat.getProposal().give],
        [firstSeat, feeSeat, { Fee: feeAmount }],
      ]),
    );
  } catch (err) {
    firstSeat.fail(err);
    secondSeat.fail(err);
    throw err;
  }

  firstSeat.exit();
  secondSeat.exit();
  return 'success';
};

let issuerNumber = 1;
const IssuerShape = M.remotable('Issuer');

const paramTypes = harden(
  /** @type {const} */ ({
    Fee: ParamTypes.AMOUNT,
  }),
);

export const meta = harden({
  customTermsShape: {
    electionManager: InstanceHandleShape,
    governedParams: {
      Fee: {
        type: ParamTypes.AMOUNT,
        value: AmountShape,
      },
      [CONTRACT_ELECTORATE]: {
        type: ParamTypes.INVITATION,
        value: AmountShape,
      },
    },
  },
  privateArgsShape: M.splitRecord(
    {
      marshaller: M.remotable('Marshaller'),
      storageNode: M.remotable('StorageNode'),
      namesByAddressAdmin: M.remotable('namesByAddressAdmin'),
    },
    {
      // only necessary on first invocation, not subsequent
      initialPoserInvitation: InvitationShape,
    },
  ),
});
export const customTermsShape = meta.customTermsShape;
export const privateArgsShape = meta.privateArgsShape;

/**
 * @param {ZCF<GovernanceTerms<paramTypes>>} zcf
 *
 * @typedef {{
 *   initialPoserInvitation: Invitation;
 *   storageNode: StorageNode;
 *   marshaller: Marshaller;
 * }} GovPrivateArgs
 *
 * @param {GovPrivateArgs & {
 *   namesByAddressAdmin: import('@agoric/vats').NamesByAddressAdmin
 * }} privateArgs
 * @param {import('@agoric/vat-data').Baggage} baggage
 */
export const start = async (zcf, privateArgs, baggage) => {
  // set up fee handling
  const { namesByAddressAdmin } = privateArgs;
  /** @type { ERef<Issuer<"nat">> } */
  const stableIssuer = await E(zcf.getZoeService()).getFeeIssuer();
  const feeBrand = await E(stableIssuer).getBrand();
  const { zcfSeat: feeSeat } = zcf.makeEmptySeatKit();
  const depositFacetFromAddr = fixHub(namesByAddressAdmin);

  const { publicMixin, makeDurableGovernorFacet, params } =
    await handleParamGovernance(
      zcf,
      privateArgs.initialPoserInvitation,
      paramTypes,
      privateArgs.storageNode,
      privateArgs.marshaller,
    );

  // TODO: update with Fee param
  const feeShape = makeNatAmountShape(feeBrand, params.getFee().value);

  /**
   * @param { ZCFSeat } firstSeat
   * @param {{ addr: string }} offerArgs
   */
  const makeSecondInvitation = async (firstSeat, offerArgs) => {
    mustMatch(offerArgs, harden({ addr: M.string() }));
    const { addr: secondPartyAddress } = offerArgs;

    const makeSecondProposalShape = want => {
      const givePattern = Object.fromEntries(
        Object.keys(want).map(k => [k, M.any()]),
      );

      return M.splitRecord({
        give: M.splitRecord(givePattern),
      });
    };

    const { want: want1, give: give1 } = firstSeat.getProposal();

    /** @type {OfferHandler} */
    const secondSeatOfferHandler = secondSeat => {
      if (!matches(secondSeat.getProposal(), makeSecondProposalShape(want1))) {
        // The second invitation was burned; let them both know it didn't work
        const error = Error(
          `Proposals didn't match, first want: ${q(want1)}, second give: ${q(
            secondSeat.getProposal().give,
          )}`,
        );
        secondSeat.fail(error);
        firstSeat.fail(error);
        return;
      }

      return swapWithFee(zcf, firstSeat, secondSeat, feeSeat, params.getFee());
    };

    const secondSeatInvitation = await zcf.makeInvitation(
      secondSeatOfferHandler,
      'matchOffer',
      { give: give1, want: want1 }, // "give" and "want" are from the proposer's perspective
    );

    const secondDepositFacet = await E(depositFacetFromAddr).lookup(
      secondPartyAddress,
      'depositFacet',
    );

    await E(secondDepositFacet).receive(secondSeatInvitation);
    return 'invitation sent';
  };

  /**
   * returns an offer to create a specific swap
   *
   * @param {Issuer[]} issuers
   */
  const makeFirstInvitation = issuers => {
    mustMatch(issuers, M.arrayOf(IssuerShape));
    for (const i of issuers) {
      if (!Object.values(zcf.getTerms().issuers).includes(i)) {
        zcf.saveIssuer(i, `Issuer${(issuerNumber += 1)}`);
      }
    }
    const proposalShape = M.splitRecord({
      give: M.splitRecord({ Fee: feeShape }),
    });

    const firstInvitation = zcf.makeInvitation(
      makeSecondInvitation,
      'create a swap',
      undefined,
      proposalShape,
    );
    return firstInvitation;
  };

  const publicFacet = Far('Public', {
    makeFirstInvitation,
    ...publicMixin,
  });
  const limitedCreatorFacet = Far('Creator', {
    makeCollectFeesInvitation() {
      return makeCollectFeesInvitation(zcf, feeSeat, feeBrand, 'Fee');
    },
  });
  const { governorFacet } = makeDurableGovernorFacet(
    baggage,
    limitedCreatorFacet,
  );
  return harden({ publicFacet, creatorFacet: governorFacet });
};
harden(start);
