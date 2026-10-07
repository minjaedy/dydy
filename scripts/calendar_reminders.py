"""App-independent Telegram reminders. No third-party dependencies."""
import datetime as dt
import hashlib
import json
import os
import sys
from pathlib import Path
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

BASE = 'https://dydy-96bb1-default-rtdb.firebaseio.com/'
PEOPLE = ('rabbit', 'sweet')

def request(path, data=None, method=None, headers=None):
    req = urllib.request.Request(BASE + path + '.json', data=None if data is None else json.dumps(data).encode(), method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response), response.headers

def automatic(year):
    rows = json.loads(Path(__file__).with_name('special-days.json').read_text(encoding='utf-8'))
    events = [dict(title=row[1], date=f'{year}-{row[0]}', owner=row[2] if len(row)>2 else 'together', kind='anniversary') for row in rows]
    start = dt.date(2026, 2, 18)
    if year >= 2026:
        events.append(dict(title='우리의 첫날' if year==2026 else f'{year-2026}주년', date=f'{year}-02-18', owner='together', kind='anniversary'))
    for count in range(100, (dt.date(year,12,31)-start).days+2, 100):
        date = start + dt.timedelta(days=count-1)
        if date.year == year:
            events.append(dict(title=f'{count}일', date=str(date), owner='together', kind='anniversary'))
    return events

def title_key(title):
    for char in '♥♡🎂 ': title=title.replace(char,'')
    return title.replace('우리의','').replace('토끼생일','이토끼생일').replace('고구마생일','구마구마생일').replace('구마생일','구마구마생일')

def due(saved, today):
    events=[]
    for event_id, e in saved.items():
        if not isinstance(e,dict) or not isinstance(e.get('title'),str): continue
        for date in (today,today+dt.timedelta(days=1)):
            expected = str(date)
            if e.get('yearly'):
                match = str(e.get('date',''))[5:] == expected[5:] and str(e.get('date','')) <= expected
            else: match = e.get('date') == expected
            if match and (date == today or e.get('kind') == 'anniversary'):
                events.append(dict(e,id=event_id,occurrence=expected))
    for year in {today.year,(today+dt.timedelta(days=1)).year}:
        for e in automatic(year):
            if e['date'] not in {str(today),str(today+dt.timedelta(days=1))}: continue
            if any(x['occurrence']==e['date'] and title_key(x['title'])==title_key(e['title']) for x in events): continue
            events.append(dict(e,id='auto-'+hashlib.sha256((e['date']+e['title']).encode()).hexdigest()[:20],occurrence=e['date']))
    return events

def enabled(settings, event):
    if settings.get('telegram') is not True: return False
    # Daily personal events have no separate switch; the Telegram master switch applies.
    return settings.get(event.get('kind'),True) is not False

def deliver(owner, event, today):
    key='scheduled_'+event['id']+'_'+event['occurrence']+'_'+str(today)
    path='couple_home_v1/telegramDeliveries/'+owner+'/'+key
    old, headers=request(path, headers={'X-Firebase-ETag':'true'})
    now=dt.datetime.now(dt.timezone.utc).timestamp()*1000
    if old and (old.get('state')=='sent' or old.get('leaseUntil',0)>now): return False
    try:
        request(path,dict(state='sending',leaseUntil=now+120000),method='PUT',headers={'if-match':headers['ETag']})
    except urllib.error.HTTPError as error:
        if error.code == 412: return False
        raise
    tomorrow=event['occurrence'] != str(today)
    text='♡ our days\n'+('내일의 기념일' if tomorrow else '오늘의 기념일' if event.get('kind')=='anniversary' else '오늘의 일정')+'\n'+event['title']+'\n'+event['occurrence']+(' · '+event['time'] if event.get('time') else '')
    try:
        config=json.loads(os.environ['COUPLE_TELEGRAM_CONFIG'])
        req=urllib.request.Request('https://api.telegram.org/bot'+config['token']+'/sendMessage',data=json.dumps({'chat_id':config[owner],'text':text[:3500]}).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=25) as response:
            if not json.load(response).get('ok'): raise RuntimeError('Telegram rejected delivery')
        request(path,dict(state='sent',leaseUntil=0,sentAt=now),method='PUT')
        return True
    except Exception:
        request(path,dict(state='failed',leaseUntil=0),method='PUT')
        # Never print exception URLs: Telegram URLs contain the bot credential.
        raise RuntimeError('Reminder delivery failed; check Telegram and database permissions') from None

def main():
    now=dt.datetime.now(ZoneInfo('Asia/Seoul'))
    dry_run='--dry-run' in sys.argv
    if not dry_run and not 9 <= now.hour < 12:
        print('Outside the 09:00–12:00 KST delivery window.'); return
    saved,_=request('couple_calendar_v1/events'); preferences,_=request('couple_home_v1/preferences')
    if dry_run:
        config=json.loads(os.environ['COUPLE_TELEGRAM_CONFIG'])
        assert all(config.get(key) for key in ('token','rabbit','sweet'))
        print('PASS: read-only database access and Telegram configuration. No messages sent.')
        return
    count=0
    for event in due(saved or {},now.date()):
        for owner in PEOPLE:
            if event.get('owner','together') not in ('together',owner): continue
            if enabled((preferences or {}).get(owner,{ }),event): count+=deliver(owner,event,now.date())
    print(f'Completed: {count} reminders delivered.')

if __name__ == '__main__': main()
