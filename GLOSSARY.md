# GateHub explorer

The words the explorer and its data APIs use for what they show about the XRP Ledger and Xahau: the ledgers, the accounts and
their names, the tokens, the network's servers, and the money in it.

## Environments and networks

**Production**:
The explorer at explorer.gatehub.net and its data APIs, on the main XRPL and Xahau networks.

**Sandbox**:
The explorer at explorer.sandbox.gatehub.net and its data APIs, on XRPL Testnet and Xahau Testnet.
_Avoid_: staging, test environment

**Network**:
One of the ledgers the explorer shows: XRPL or Xahau in production, XRPL Testnet or Xahau Testnet in the sandbox.
_Avoid_: chain, ledger (for the whole network)

**Testnet**:
A test network of XRPL or Xahau, whose currency has no value and which can be reset: XRPL Testnet and Xahau Testnet, which the
sandbox shows.
_Avoid_: altnet, devnet (another network)

## The index

**Coverage**:
Where a list's or a figure's history in the index starts, and whether the index holds all of it since the feature began on the
network. A list whose coverage is not complete says so in a note under it.
_Avoid_: completeness, backfill status

## Accounts and names

**Display name**:
The name the explorer shows for an account instead of its address: its verified name, else its account name, else its unverified
domain.
_Avoid_: label, alias, tag

**Verified name**:
A name both sides confirm: the account's domain lists the account in its toml, and the account names that domain.
_Avoid_: verified label

**Account name**:
The name GateHub gives an address, the same on every network, shown as "Named by GateHub".
_Avoid_: curated name, label, manual name

**Account network name**:
The name GateHub gives an account on one network, which says what it does there, such as "USD Issuer". It adds to the account name.
_Avoid_: account name (when one network is meant)

**Account domain**:
The domain an account's Domain field names, when it is a well-formed domain; a URL or an IPFS hash names none.
_Avoid_: domain field (for the domain itself), website

**Unverified domain**:
A domain an account names whose toml does not list the account.

**Label**:
A warning GateHub puts on an address, from a fixed list (scam, spam, advisory). It holds on every network.
_Avoid_: flag, tag

**Name mark**:
The small mark beside a display name that says its kind: verified, named by GateHub, or not verified.
_Avoid_: badge

**Label mark**:
The warning mark beside a labelled account's name or address, wherever it appears.
_Avoid_: flag

**Toml**:
The file a domain publishes about its validators, accounts, servers, currencies and principals: `xrp-ledger.toml` for XRPL,
`xahau.toml` for Xahau.
_Avoid_: TOML file, well-known file

**Principal**:
A person a toml names as responsible for the domain's validators or accounts. The explorer shows their names only.

## Tokens

**Token**:
Any asset other than the network's own: an issued token or an MPT.
_Avoid_: asset (for the native currency), coin

**Issued token**:
A token that lives on trust lines, named by its currency code and its issuer.
_Avoid_: IOU, issued currency, trust-line token

**MPT**:
A multi-purpose token: a token that lives in its issuance and its holders' balances, named by its issuance ID.
_Avoid_: MPToken (in prose), multi-purpose token (after first use)

**Issuer**:
The account that issues a token.
_Avoid_: gateway

**Holder**:
An account that holds a positive balance of a token.
_Avoid_: owner (an NFT's word)

**Trust line**:
The link between an account and an issuer along which an issued token is held.
_Avoid_: RippleState (in prose)

**Supply**:
Of an issued token: the sum of its holders' balances, which is what its issuer owes. The native currency has a total supply and a
circulating supply instead, and an MPT an outstanding amount.
_Avoid_: circulating supply, outstanding amount (for an issued token)

**Listed in the issuer's toml**:
Said of an issued token whose issuer's account domain lists it, by code and issuer, under `[[CURRENCIES]]` in its toml. It says who
publishes the token, not what it is worth.
_Avoid_: verified token

**Transfer**:
A move of a token or an NFT from one account to another: a payment that delivered a token (issuing and redeeming included), or an
NFT changing owner without a price.
_Avoid_: trade (an exchange on the DEX)

**Issuance ID**:
The 48 hex digits that name an MPT: the sequence of the transaction that created it and its issuer.
_Avoid_: MPT ID, currency (for an MPT)

**Asset scale**:
The power of ten an MPT's amounts are divided by to be read: at scale 2, 100 on the ledger is 1.
_Avoid_: decimals, precision

**Outstanding amount**:
Of an MPT: how much of it its holders hold, escrowed amounts included.
_Avoid_: supply (an issued token's word), circulating

**Escrowed amount**:
Of an MPT: the part of its outstanding amount held in escrows.
_Avoid_: locked amount

**Locked balance**:
An MPT balance its issuer has locked, so that it cannot move until unlocked; an issuer can lock one holder's balance or every
balance.
_Avoid_: frozen (a trust line's word), escrowed

## NFTs

**NFT**:
A non-fungible token: one token of its own, with an issuer and a URI. On XRPL an NFToken, on Xahau a URIToken.
_Avoid_: collectible

**NFToken**:
XRPL's kind of NFT, whose ID carries its flags, transfer fee, issuer, taxon and serial.

**URIToken**:
Xahau's kind of NFT: a ledger entry named by its issuer and its URI.
_Avoid_: URI token

**Collection**:
The NFTs of one issuer and one taxon on XRPL, or of one issuer on Xahau.
_Avoid_: series, set

**Taxon**:
The number an XRPL issuer gives a group of its NFTs; with the issuer it names a collection.

**Serial**:
The number an XRPL issuer's NFT gets when it is minted, one more for each of the issuer's NFTs.
_Avoid_: token number, edition

**NFT owner**:
The account that holds an NFT.
_Avoid_: holder (for one NFT)

**Collection holder**:
An account that owns at least one NFT of a collection.

**Sale**:
An NFT changing owner for a price through an accepted offer: direct, when the buyer or the seller accepts the other's offer, or
brokered, when a third account matches a buy and a sell offer and keeps a fee.

**Royalty**:
The issuer's cut of an NFT's sale, set by the NFT's transfer fee. The explorer shows an estimate.
_Avoid_: creator fee

**Open offer**:
An offer to buy or sell an NFT that is still in the ledger: not accepted, cancelled or removed. An expired offer stays open until
something removes it.

## The network's servers

**Node**:
A `rippled` or `xahaud` server in a network's peer network.
_Avoid_: peer, server, rippled (for any node)

**Validator**:
A node whose validations count towards consensus, known by its master key.
_Avoid_: validating node

**Fixed list**:
Validators a network's nodes trust from their own configuration, with no publisher. Xahau Testnet's are the only ones.
_Avoid_: static UNL, local UNL

**Server country**:
The country a validator's verified toml says its server is in.
_Avoid_: location, geolocation

**Owner country**:
The country a validator's verified toml says its owner is in.
_Avoid_: nationality

**Unknown location**:
Said of a validator whose verified toml gives no valid server country, or that has no verified toml.
_Avoid_: unlocated

## Supply and distribution

**Total supply**:
All of the native currency that exists: on XRPL, 100 billion XRP less what has been burned; on Xahau, what it started with and what
has been minted, less what has been burned.

**Burned**:
Native currency destroyed as transaction fees.

**Minted**:
Native currency created on Xahau after its start: by rewards, by Import for XRP burned on XRPL, and by GenesisMint. (An NFT's mint
creates an NFT, not native currency.)
_Avoid_: inflation, issuance

**Reward**:
XAH that Xahau mints for an account that claims it.
_Avoid_: staking reward, interest

**Escrowed**:
Native currency held in escrows.

**Circulating supply**:
The total supply less what is escrowed.
_Avoid_: free float, liquid supply

**Account reserves**:
The native currency accounts must keep and cannot send: a base reserve for each account and an owner reserve for each object it
owns. Part of the circulating supply.
_Avoid_: locked, reserved balance

**Rich list**:
The accounts that hold the most of the native currency, in order.

**Balance bracket**:
A range of native-currency balances, and the accounts whose balance falls in it.

## Ledger objects

**Ledger object ID**:
The 64 hex digits that name an entry in the ledger, such as an escrow, a check or a payment channel. It stays the object's name after
it is removed.
_Avoid_: index, hash

**Escrow**:
Native currency or a token an account sets aside for a destination until a time passes or a condition is met. It is pending, can be
finished or can be cancelled, then is finished or cancelled.

**Check**:
A deferred payment its destination may cash, up to a limit, until it expires or is cancelled.

**Payment channel**:
Native currency or a token set aside for one destination, paid out in many off-ledger claims and settled on the ledger.
_Avoid_: paychan

**Removed**:
Said of a ledger object that is no longer in the ledger, however it went: finished, cancelled, cashed, closed, or deleted by another
transaction. Its page shows it from history.
_Avoid_: deleted, closed (for every kind)

## Delegation

**Delegation**:
An account's grant to another account of permission to send some kinds of transaction on its behalf.

**Delegate**:
The account that receives a delegation and sends transactions on the other's behalf.

**Permission**:
One kind of transaction, or one narrower right, that a delegation grants.

**Fee payer**:
The account that paid a transaction's fee: its sender, or the delegate when a delegate sent it.
_Avoid_: sender (when a delegate paid)
