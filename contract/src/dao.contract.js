// @ts-check

import { Far } from '@endo/far';
import { M, getCopyBagEntries, makeCopyBag } from '@endo/patterns';
import { AssetKind } from '@agoric/ertp/src/amountMath.js';
import '@agoric/zoe/exported.js';
import { AmountShape } from '@agoric/ertp';
import { atomicRearrange } from '@agoric/zoe/src/contractSupport/atomicTransfer.js';


const { Fail, quote: q } = assert;

// TODO: use shape 
const VoteShape = M.recordOf(M.string(), {
 voteAmount: AmountShape,
});


export const terms = harden({
    DaoTerms:  {
        DaoToken: AmountShape,
        Membership: AmountShape,
}});

export const start = async zcf => {

    //dao proposal abstractions 
    const proposals = new Map(); // track proposals by UIDs
    let nextProposalId = 1n; // naive generate proposal IDs

    // create a mints
    const daoTokenMint = await zcf.makeZCFMint('DaoToken', AssetKind.NAT);
    const { brand: daoTokenBrand, issuer: daoTokenIssuer } = daoTokenMint.getIssuerRecord();
    console.log(daoTokenMint)
    
    const membershipMint = await zcf.makeZCFMint('Membership', AssetKind.COPY_BAG);
    const { brand: membershipBrand, issuer: membershipIssuer } = membershipMint.getIssuerRecord();
    console.log(membershipMint)

    // mint initial DAO tokens
    const initialDaoTokens = 100n;
    const { zcfSeat: initialDaoSeat } = zcf.makeEmptySeatKit();

    console.log(initialDaoSeat)

    const toMint = {
        DaoTokens: {
            brand: daoTokenBrand,
            value: initialDaoTokens,
        },
    };

    daoTokenMint.mintGains(toMint);

    //create proposal func
    const createProposal = (title, details) => {
        const id = nextProposalId++;
        proposals.set(id, { id, title, details, votesFor: 0n, votesAgainst: 0n });
        return id;
    };

    //join proposal
    const joinProposalShape = harden({
        give: { },
        want: { 
            NewMembership: { 
                brand: membershipBrand, 
                value: M.bag() 
            }, 
            DaoTokens: { 
                brand: daoTokenBrand, 
                value: M.nat()
            }, 
        },
        exit: M.any(), 
    });

    //vote proposal
    const voteProposalShape = harden({
        give: { 
            CurrentMembership: {
                brand: membershipBrand, 
                value: M.bag(), 
            },
            Votes: { brand: daoTokenBrand, value: M.gte(10n) }
        },
        want: {
            NewMembership: {
                brand: membershipBrand, 
                value: M.bag(), 
            }
        },
        exit: M.any(),
    })
    
    
    // initialDaoSeat.exit(); // close the seat after minting? 

    // allow users to join and receive a Membership NFT
    const joinDao = async (joiningmMemberSeat) => {

        /** @type {[string, bigint][]} */
        const choices = [
            ['MembershipCard1', 1n],
        ];

        const choiceBag = makeCopyBag(choices);
        const membershipToMint = {
            NewMembership: {
                brand: membershipBrand,
                value: choiceBag,
            },
        };

        const daoTokenToMint = {
            DaoTokens: {
                brand: daoTokenBrand,
                value: 10n,
            },
        };

        daoTokenMint.mintGains(daoTokenToMint, joiningmMemberSeat); //DAO tokens on joining
        membershipMint.mintGains(membershipToMint, joiningmMemberSeat); //membership card on join int

        joiningmMemberSeat.exit(); // close the seat after minting
        return 'Membership NFT granted with DAO tokens.';
    };

    const makeJoinInvitation = () => zcf.makeInvitation(joinDao, "Simple Dao Join", undefined, joinProposalShape);

    // allow voTing if a member has an NFT and gives DAO tokens
    const vote = async (voterSeat, { proposalId, voteFor }) => {
        const membershipHeld = voterSeat.getAmountAllocated('Membership', membershipBrand);
        const daoTokensGiven = voterSeat.getAmountAllocated('Votes', daoTokenBrand);
        const proposal = proposals.get(proposalId);
        const { give, want } = voterSeat.getProposal();

        if (!membershipHeld || !daoTokensGiven) {
            throw new Error("Must hold a Membership NFT and DAO tokens to vote.");
        }

        if (!proposal) {
            throw new Error("Proposal not found.");
        }

        if (voteFor) {
            proposal.votesFor += daoTokensGiven.value;
        } else {
            proposal.votesAgainst += daoTokensGiven.value;
        }

        /** @type {[string, bigint][]} */
        const choices = [
            ['MembershipCard2', 1n],
        ];

        const choiceBag = makeCopyBag(choices);
        const membershipToMint = {
            NewMembership: {
                brand: membershipBrand,
                value: choiceBag,
            },
        };

        // create seat for swapping from proceed to voterSeat, what happens to this seats purse when its done? 
        // does it burn, because nothing happens with the purse? if so we probably want to send to the DAO seat?
        const proceeds = membershipMint.mintGains(membershipToMint);

        atomicRearrange(
            zcf,
            harden([
                // membership token from voter to membershipMint
                // TODO: split give to two seats?
                [voterSeat, initialDaoSeat, give ],
                [proceeds, voterSeat, want],
                
            ]),
        );
        voterSeat.exit(true)
        return `Vote accepted. ${daoTokensGiven.value} DaoTokens spent.`;
    };

    const makeVoteInvitation = () => zcf.makeInvitation(vote, "Simple Dao Vote", undefined, voteProposalShape);

    const publicFacet = Far('Dao Public Facet', {
        makeJoinInvitation,
        makeVoteInvitation,
        createProposal,
    });

    return { publicFacet };
}