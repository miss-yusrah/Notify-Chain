use crate::{AutoShareContract, AutoShareContractClient};
use soroban_sdk::Env;

#[test]
fn test_version() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AutoShareContract);
    let client = AutoShareContractClient::new(&env, &contract_id);

    assert_eq!(client.version(), 1);
}
