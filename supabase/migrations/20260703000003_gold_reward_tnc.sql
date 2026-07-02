-- Round 3 item 6: append gold-reward T&Cs (bilingual) to the enquiry-form
-- T&C body. Idempotent via the marker string. Content stays admin-editable.
UPDATE system_settings
SET enquiry_form = jsonb_set(
  enquiry_form,
  '{tnc_body}',
  to_jsonb((enquiry_form->>'tnc_body') || $gold$

Gold Reward Terms & Conditions

1. 必须更新车险才能享有此优惠
Offer only applicable for customers who renew their car insurance.

2. 黄金奖励额度为车险总保费（Gross Premium）的 10%
Gold reward is equivalent to 10% of your car insurance Gross Premium.

3. 相等于车险总保费（Gross Premium）10% 的黄金奖励仅用于兑换黄金，不可兑换现金
Gold reward equivalent to 10% of the car insurance Gross Premium can only be used to redeem gold products through the appointed Gold Partners and strictly not transferable for cash.

4. 黄金奖励仅可用于指定金店兑换黄金产品
The gold reward can only be redeemed for gold products at the appointed Gold Partners.

5. 客户必须在 3 个月内完成兑换
Customers must redeem their gold reward within 3 months from the date of issuance.

6. Example（例子说明）
如果您的车险总保费（Gross Premium）是 RM10,000，您将获得相等于 10%（RM1,000）的黄金奖励。RM1,000 将支付给指定金店，并可用于兑换黄金产品。
If your car insurance Gross Premium is RM10,000, you will receive a gold reward equivalent to 10% (RM1,000). The RM1,000 amount will be paid to the appointed gold shop and can be used to redeem gold products.$gold$)
)
WHERE enquiry_form->>'tnc_body' NOT LIKE '%Gold Reward Terms & Conditions%';
