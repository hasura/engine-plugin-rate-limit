-- Keys this script will read/write:
local redisKey   = KEYS[1]

-- Additional arguments:
local applicableLimit           = tonumber(ARGV[1]) -- Rate limit set for the project
local currTime                  = tonumber(ARGV[2]) -- Current time in seconds
local prevTime                  = tonumber(ARGV[3]) -- (Current time - sliding window length) (seconds)
local slidingWindow             = tonumber(ARGV[4]) -- sliding window length (seconds)
local currRequestMember         = ARGV[5]           -- Unique identifier of the current request

redis.call('ECHO', 'Keys: ' .. redisKey);
redis.call('ECHO', 'Args: ' .. currTime .. ' ' .. prevTime .. ' ' .. currRequestMember);

-- remove all keys older than the previous timestamp
redis.call('ZREMRANGEBYSCORE', redisKey, 0, prevTime);

-- get the count of the timestamps that exist in the sorted set when we
-- query it.
local cardinality = redis.call('ZCARD', redisKey)
redis.call('ECHO', 'Current request rate: ' .. cardinality)

if cardinality < applicableLimit
then
    -- add an entry for the current timestamp only if the rate limit is not
    -- exceeded
    redis.call('ZADD', redisKey, currTime, currRequestMember);
    -- set an expiry of 'slidingWindow' time; if the key is accessed again
    -- within the 'slidingWindow' time, we reset the expiry. So that way the key
    -- exists as long as it has been accessed within a 'slidingWindow' time period.
    -- If its not accessed within a 'slidingWindow' period then the key is safe
    -- to expire.
    redis.call('EXPIRE', redisKey, math.ceil(slidingWindow));
    redis.call('ECHO', 'Added current request: ' .. currTime)
else
    redis.call('ECHO', 'Rate limit exceeded')
end

return cardinality;
