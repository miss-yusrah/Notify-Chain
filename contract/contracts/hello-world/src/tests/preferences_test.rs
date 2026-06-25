/// Recipient Preference Management Tests — Issue #178
#[cfg(test)]
mod preferences_tests {
    use crate::base::preferences::{
        CategoryPreference, ChannelPreference, DeliveryChannel, NotificationCategory,
    };
    use crate::test_utils::setup_test_env;
    use crate::{AutoShareContract, AutoShareContractClient};
    use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

    // ============================================================================
    // Default preferences
    // ============================================================================

    #[test]
    fn test_get_preferences_returns_defaults_for_new_user() {
        let test_env = setup_test_env();
        let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

        let recipient = Address::generate(&test_env.env);
        let prefs = client.get_preferences(&recipient);

        // All three channels enabled by default
        assert_eq!(prefs.channels.len(), 3);
        for ch in prefs.channels.iter() {
            assert!(ch.enabled, "Channel {:?} should be enabled by default", ch.channel);
        }

        // All five categories enabled by default
        assert_eq!(prefs.categories.len(), 5);
        for cat in prefs.categories.iter() {
            assert!(cat.enabled, "Category {:?} should be enabled by default", cat.category);
        }

        assert_eq!(prefs.recipient, recipient);
    }

    // ============================================================================
    // set_preferences (full replace)
    // ============================================================================

    #[test]
    fn test_set_preferences_updates_channels_and_categories() {
        let test_env = setup_test_env();
        let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

        let recipient = test_env.users.get(0).unwrap();

        let mut channels = Vec::new(&test_env.env);
        channels.push_back(ChannelPreference {
            channel: DeliveryChannel::Wallet,
            enabled: true,
        });
        channels.push_back(ChannelPreference {
            channel: DeliveryChannel::Email,
            enabled: false,
        });
        channels.push_back(ChannelPreference {
            channel: DeliveryChannel::InApp,
            enabled: true,
        });

        let mut categories = Vec::new(&test_env.env);
        categories.push_back(CategoryPreference {
            category: NotificationCategory::Payment,
            enabled: true,
        });
        categories.push_back(CategoryPreference {
            category: NotificationCategory::GroupMembership,
            enabled: false,
        });
        categories.push_back(CategoryPreference {
            category: NotificationCategory::GroupStatus,
            enabled: true,
        });
        categories.push_back(CategoryPreference {
            category: NotificationCategory::SystemAlerts,
            enabled: false,
        });
        categories.push_back(CategoryPreference {
            category: NotificationCategory::General,
            enabled: true,
        });

        client.set_preferences(&recipient, &channels, &categories);

        let prefs = client.get_preferences(&recipient);
        assert_eq!(prefs.channels.len(), 3);
        assert_eq!(prefs.categories.len(), 5);

        // Email should be disabled
        let email_pref = prefs
            .channels
            .iter()
            .find(|c| c.channel == DeliveryChannel::Email)
            .expect("Email channel should be present");
        assert!(!email_pref.enabled);

        // GroupMembership should be disabled
        let gm_pref = prefs
            .categories
            .iter()
            .find(|c| c.category == NotificationCategory::GroupMembership)
            .expect("GroupMembership category should be present");
        assert!(!gm_pref.enabled);
    }

    #[test]
    fn test_preferences_persist_after_page_refresh() {
        // Simulates a "page refresh" by creating a new client referencing the same contract
        let test_env = setup_test_env();

        let recipient = test_env.users.get(0).unwrap();

        {
            let client =
                AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
            let mut channels = Vec::new(&test_env.env);
            channels.push_back(ChannelPreference {
                channel: DeliveryChannel::Wallet,
                enabled: false,
            });
            channels.push_back(ChannelPreference {
                channel: DeliveryChannel::Email,
                enabled: true,
            });
            channels.push_back(ChannelPreference {
                channel: DeliveryChannel::InApp,
                enabled: false,
            });

            let mut categories = Vec::new(&test_env.env);
            categories.push_back(CategoryPreference {
                category: NotificationCategory::Payment,
                enabled: false,
            });
            categories.push_back(CategoryPreference {
                category: NotificationCategory::GroupMembership,
                enabled: true,
            });
            categories.push_back(CategoryPreference {
                category: NotificationCategory::GroupStatus,
                enabled: false,
            });
            categories.push_back(CategoryPreference {
                category: NotificationCategory::SystemAlerts,
                enabled: true,
            });
            categories.push_back(CategoryPreference {
                category: NotificationCategory::General,
                enabled: false,
            });

            client.set_preferences(&recipient, &channels, &categories);
        }

        // New client instance ("page refresh")
        let client2 =
            AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);
        let prefs = client2.get_preferences(&recipient);

        // Wallet should be disabled
        let wallet_pref = prefs
            .channels
            .iter()
            .find(|c| c.channel == DeliveryChannel::Wallet)
            .unwrap();
        assert!(!wallet_pref.enabled);

        // Payment should be disabled
        let payment_pref = prefs
            .categories
            .iter()
            .find(|c| c.category == NotificationCategory::Payment)
            .unwrap();
        assert!(!payment_pref.enabled);
    }

    // ============================================================================
    // set_channel_preference (single toggle)
    // ============================================================================

    #[test]
    fn test_set_channel_preference_disables_email() {
        let test_env = setup_test_env();
        let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

        let recipient = test_env.users.get(0).unwrap();

        // Email is enabled by default
        assert!(client.is_channel_enabled(&recipient, &DeliveryChannel::Email));

        // Disable email
        client.set_channel_preference(&recipient, &DeliveryChannel::Email, &false);

        assert!(!client.is_channel_enabled(&recipient, &DeliveryChannel::Email));
        // Wallet and InApp should still be enabled
        assert!(client.is_channel_enabled(&recipient, &DeliveryChannel::Wallet));
        assert!(client.is_channel_enabled(&recipient, &DeliveryChannel::InApp));
    }

    #[test]
    fn test_set_channel_preference_re_enables_channel() {
        let test_env = setup_test_env();
        let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

        let recipient = test_env.users.get(0).unwrap();

        client.set_channel_preference(&recipient, &DeliveryChannel::InApp, &false);
        assert!(!client.is_channel_enabled(&recipient, &DeliveryChannel::InApp));

        client.set_channel_preference(&recipient, &DeliveryChannel::InApp, &true);
        assert!(client.is_channel_enabled(&recipient, &DeliveryChannel::InApp));
    }

    // ============================================================================
    // set_category_preference (single toggle)
    // ============================================================================

    #[test]
    fn test_set_category_preference_disables_payment_notifications() {
        let test_env = setup_test_env();
        let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

        let recipient = test_env.users.get(0).unwrap();

        assert!(client.is_category_enabled(&recipient, &NotificationCategory::Payment));

        client.set_category_preference(&recipient, &NotificationCategory::Payment, &false);

        assert!(!client.is_category_enabled(&recipient, &NotificationCategory::Payment));
        // Other categories unaffected
        assert!(client.is_category_enabled(&recipient, &NotificationCategory::General));
        assert!(client.is_category_enabled(&recipient, &NotificationCategory::SystemAlerts));
    }

    #[test]
    fn test_set_category_preference_disables_system_alerts() {
        let test_env = setup_test_env();
        let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

        let recipient = test_env.users.get(1).unwrap();

        client.set_category_preference(&recipient, &NotificationCategory::SystemAlerts, &false);
        assert!(!client.is_category_enabled(&recipient, &NotificationCategory::SystemAlerts));
    }

    // ============================================================================
    // reset_preferences
    // ============================================================================

    #[test]
    fn test_reset_preferences_restores_all_defaults() {
        let test_env = setup_test_env();
        let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

        let recipient = test_env.users.get(0).unwrap();

        // Disable everything
        client.set_channel_preference(&recipient, &DeliveryChannel::Email, &false);
        client.set_channel_preference(&recipient, &DeliveryChannel::InApp, &false);
        client.set_category_preference(&recipient, &NotificationCategory::Payment, &false);
        client.set_category_preference(&recipient, &NotificationCategory::General, &false);

        assert!(!client.is_channel_enabled(&recipient, &DeliveryChannel::Email));
        assert!(!client.is_category_enabled(&recipient, &NotificationCategory::Payment));

        // Reset
        client.reset_preferences(&recipient);

        // All channels and categories back to enabled
        assert!(client.is_channel_enabled(&recipient, &DeliveryChannel::Email));
        assert!(client.is_channel_enabled(&recipient, &DeliveryChannel::InApp));
        assert!(client.is_category_enabled(&recipient, &NotificationCategory::Payment));
        assert!(client.is_category_enabled(&recipient, &NotificationCategory::General));
    }

    // ============================================================================
    // UI state – communicates active/disabled channels clearly (acceptance criteria)
    // ============================================================================

    #[test]
    fn test_ui_can_read_all_channel_states() {
        let test_env = setup_test_env();
        let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

        let recipient = test_env.users.get(0).unwrap();

        // Disable one channel
        client.set_channel_preference(&recipient, &DeliveryChannel::Email, &false);

        let prefs = client.get_preferences(&recipient);

        // Verify UI-readable state for each channel
        for ch in prefs.channels.iter() {
            match ch.channel {
                DeliveryChannel::Wallet => assert!(ch.enabled),
                DeliveryChannel::Email => assert!(!ch.enabled),
                DeliveryChannel::InApp => assert!(ch.enabled),
            }
        }
    }

    // ============================================================================
    // Auth — only recipient can modify own preferences
    // ============================================================================

    #[test]
    #[should_panic]
    fn test_other_user_cannot_set_channel_preference() {
        let env = Env::default();
        // Do NOT mock all auths — enforce real auth
        let contract_id = env.register(AutoShareContract, ());
        let client = AutoShareContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize_admin",
                args: (admin.clone(),).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.initialize_admin(&admin);

        let victim = Address::generate(&env);
        let attacker = Address::generate(&env);

        // Attacker tries to disable victim's notifications — should fail
        client.mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &attacker,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_channel_preference",
                args: (
                    victim.clone(),
                    DeliveryChannel::Wallet,
                    false,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.set_channel_preference(&victim, &DeliveryChannel::Wallet, &false);
    }

    // ============================================================================
    // Multiple recipients are independent
    // ============================================================================

    #[test]
    fn test_preferences_are_per_recipient() {
        let test_env = setup_test_env();
        let client = AutoShareContractClient::new(&test_env.env, &test_env.autoshare_contract);

        let user1 = test_env.users.get(0).unwrap();
        let user2 = test_env.users.get(1).unwrap();

        // user1 disables email
        client.set_channel_preference(&user1, &DeliveryChannel::Email, &false);
        // user2 disables wallet
        client.set_channel_preference(&user2, &DeliveryChannel::Wallet, &false);

        // user1 – email disabled, wallet enabled
        assert!(!client.is_channel_enabled(&user1, &DeliveryChannel::Email));
        assert!(client.is_channel_enabled(&user1, &DeliveryChannel::Wallet));

        // user2 – wallet disabled, email enabled
        assert!(!client.is_channel_enabled(&user2, &DeliveryChannel::Wallet));
        assert!(client.is_channel_enabled(&user2, &DeliveryChannel::Email));
    }
}
