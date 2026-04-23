import redis

from ..config import get_settings


_settings = get_settings()

redis_client: redis.Redis = redis.Redis.from_url(
    _settings.redis_url, decode_responses=True
)

redis_client.json().set('user:1', '$', {
    'name': 'Alice',
    'emails': ['alice@example.com', 'alice@work.com'],
    'address': {'city': 'NYC', 'zip': '10001'}
})

print(redis_client.json().get('user:1', '$'))            # [{'name': 'Alice', 'emails': [...], 'address': {...}}]
print(redis_client.json().get('user:1', '$.name'))       # ['Alice']
print(redis_client.json().get('user:1', '$.emails[0]'))  # ['alice@example.com']
print(redis_client.json().get('user:1', '$.address.zip'))# ['10001']