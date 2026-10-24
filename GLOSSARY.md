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

## Accounts and names

**Account name**:
The name the explorer shows for an account instead of its address: a verified name or a curated name.
_Avoid_: label, alias, tag

**Verified name**:
An account name both sides confirm: the account's domain lists the account in its toml, and the account names that domain.
_Avoid_: verified label

**Curated name**:
An account name GateHub gives an account that has no verified name, such as an exchange's hot wallet, shown with its own mark.
_Avoid_: label, manual name

**Unverified domain**:
A domain an account names whose toml does not list the account.

**Toml**:
The file a domain publishes about its validators, accounts, servers, currencies and principals: `xrp-ledger.toml` for XRPL,
`xahau.toml` for Xahau.
_Avoid_: TOML file, well-known file

**Principal**:
A person a toml names as responsible for the domain's validators or accounts.

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
An account that holds a balance of a token.
_Avoid_: owner

**Trust line**:
The link between an account and an issuer along which an issued token is held.
_Avoid_: RippleState (in prose)

## The network's servers

**Node**:
A `rippled` or `xahaud` server in a network's peer network.
_Avoid_: peer, server, rippled (for any node)

**Validator**:
A node whose validations count towards consensus, known by its master key.
_Avoid_: validating node

## Supply and distribution

**Total supply**:
All of the native currency that exists: on XRPL, 100 billion XRP less what has been burned.

**Burned**:
Native currency destroyed as transaction fees.

**Escrowed**:
Native currency held in escrows.

**Circulating supply**:
The total supply less what is escrowed.
_Avoid_: free float, liquid supply

**Rich list**:
The accounts that hold the most of the native currency, in order.

**Balance bracket**:
A range of native-currency balances, and the accounts whose balance falls in it.

## Ledger objects

**Escrow**:
Native currency an account sets aside until a time passes or a condition is met; it is pending, can be finished, can be
cancelled, finished or cancelled.

**Check**:
A deferred payment its destination may cash, up to a limit, until it expires or is cancelled.

**Payment channel**:
Native currency set aside for one destination, paid out in many off-ledger claims and settled on the ledger.
_Avoid_: paychan

## Delegation

**Delegation**:
An account's grant to another account of permission to send some kinds of transaction on its behalf.

**Delegate**:
The account that receives a delegation and sends transactions on the other's behalf.

**Permission**:
One kind of transaction, or one narrower right, that a delegation grants.
