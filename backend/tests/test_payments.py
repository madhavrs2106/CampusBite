from __future__ import annotations

import hashlib
import hmac
import unittest

from app.api.payments import signature_matches


class RazorpaySignatureTests(unittest.TestCase):
    def test_checkout_signature_accepts_canonical_order_and_payment(self) -> None:
        secret = "test-secret"
        message = b"order_123|pay_456"
        signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
        self.assertTrue(signature_matches(secret, message, signature))

    def test_signature_rejects_modified_body_or_signature(self) -> None:
        secret = "test-secret"
        message = b"{\"event\":\"payment.captured\"}"
        signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
        self.assertFalse(signature_matches(secret, message + b" ", signature))
        self.assertFalse(signature_matches("different-secret", message, signature))


if __name__ == "__main__":
    unittest.main()
