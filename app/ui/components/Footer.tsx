import { CREDIT, PRODUCT_NAME } from "../brand";

export function Footer() {
  return (
    <footer className="ftr">
      <div className="container ftr__inner">
        <span>
          {PRODUCT_NAME} &middot; {CREDIT}
        </span>
        <span>History from validated ledgers. Balances and account state read live from the network.</span>
      </div>
    </footer>
  );
}
