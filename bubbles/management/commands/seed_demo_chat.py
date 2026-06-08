"""
Seed 5 demo bubbles with 10 users each and realistic Hindi/English chat.

Usage:
  python manage.py seed_demo_chat
  python manage.py seed_demo_chat --lat 19.076 --lng 72.8777
  python manage.py seed_demo_chat --clear
  docker compose exec web python manage.py seed_demo_chat
"""
from __future__ import annotations

import random
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from bubbles.models import Bubble, Message

# Default: Mumbai — change with --lat / --lng so bubbles show in nearby list
DEFAULT_LAT = 19.0760
DEFAULT_LNG = 72.8777

BUBBLE_TITLES = [
    "Best chai & coffee in town ☕",
    "Night hangout spots 🌙",
    "Weekend plan kya hai?",
    "Street food recommendations 🌮",
    "Bakwas lunch rant 😤",
]

# Also remove bubbles from older seed runs when using --clear
LEGACY_DEMO_TITLES = [
    "Late night chai & baatein ☕",
    "Andheri metro crowd 🚇",
    "Best street food near me 🌮",
    "Internship / placement gyaan",
]

# 10 personas per bubble
USER_POOLS = [
    ["ChaiLover", "FilterFan", "CuttingChai", "ColdBrew", "MasalaGirl", "IraniCafe", "OfficeChai", "LatteArt", "GingerTea", "EspressoBro"],
    ["NightOwl", "AfterHours", "MarineDrive", "RooftopGuy", "LiveMusic", "SafeSolo", "2amHungry", "ClubNoob", "WalkTalk", "StarGazer"],
    ["WeekendKing", "BrunchQueen", "Trekker", "MovieBuff", "Homebody", "Foodie", "BudgetTravel", "PoolParty", "Sleepyhead", "Spontaneous"],
    ["PavBhaji", "Momos4Life", "ChaatLover", "VadaPav", "DosaKing", "KebabFan", "SweetTooth", "SpiceLevel", "VegOnly", "MidnightBiryani"],
    ["CanteenVictim", "TiffinFail", "MaggiForever", "SaladSad", "HRlunch", "WfhEater", "SkipLunch", "Cafeteria", "HangryDev", "MealPrep"],
]

# (speaker_index, message) — Hindi/English mix, topic-focused
CONVERSATIONS = [
    # 1 — Best chai & coffee in town
    [
        (0, "Guys serious debate — best cutting chai in town kahan milti hai?"),
        (1, "Filter coffee South Indian joints pe jeet jaati hai, chai ke liye tapri."),
        (2, "Tapri near station — adrak strong, half cup ₹10. Peak."),
        (3, "Coffee mein Blue Tokai ya local roastery try ki hai kisi ne?"),
        (4, "Local roastery better value. Blue Tokai weekend queue nightmare."),
        (5, "Masala chai vs normal chai — kitna masala is too much?"),
        (6, "Elaichi overdose = perfume cup 😂 thoda hi sahi."),
        (7, "Genuine question: chai bag wali ya fresh patti — taste difference real?"),
        (8, "Fresh patti always. Bag wali office emergency only."),
        (9, "Cold coffee summer mein bhi chai peete ho ya switch?"),
        (0, "Switch nahi — cutting chai garam hi chahiye year round."),
        (1, "Irani cafe bun maska + chai combo — underrated?"),
        (2, "Highly underrated. Breakfast of champions."),
        (3, "Best coffee under ₹150? Student budget friendly."),
        (4, "Cappuccino at small cafes — ask for double shot, still cheap."),
        (5, "Chai pe charcha — do you judge people by tea vs coffee team?"),
        (6, "Nahi yaar, dono valid. Main dono peeta hun."),
        (7, "Night shift — chai kitni cup max? Meri record 7 hai 💀"),
        (8, "After 4 I get anxiety. Green tea switch karo."),
        (9, "Okay vote: tapri chai > fancy cafe?"),
        (0, "Tapri for soul. Cafe for laptop and WiFi."),
        (1, "Thanks — ab chai peene ja raha hun, recommendations solid thi ✌️"),
    ],
    # 2 — Night hangout
    [
        (0, "Aaj raat kahan hangout kar sakte hain? Safe + fun chahiye."),
        (1, "Marine Drive walk — free, open, couples + friends dono."),
        (2, "Rooftop cafe after 10 — vibe achhi but pricey."),
        (3, "Solo jaana safe hai kya late night? Genuine question."),
        (4, "Crowded public spots OK. Empty lanes avoid. Share live location."),
        (5, "Best time for night drive — 11 pm ya 1 am?"),
        (6, "11 pm traffic kam. 1 am feels cinematic but sleepy drivers."),
        (7, "Live music wala spot koi batao is week."),
        (8, "Check Instagram stories of local bars — guest list scene."),
        (9, "Food after midnight — kya open rehta hai seriously?"),
        (0, "Shawarma spots, some McD 24h, and the legendary anda pav stall."),
        (1, "Club jaana hai first time — entry scene kaisa hota hai?"),
        (2, "Cover charge + ID. Prebook if popular night."),
        (3, "Budget hangout under ₹500 per person — ideas?"),
        (4, "Beach + street food + auto ride. Done."),
        (5, "Late night chai tapri pe baith ke gossip > club any day."),
        (6, "Star gazing spot outskirts pe — worth the drive?"),
        (7, "Haan if weather clear. Mosquito repellent le lena 😅"),
        (8, "Curfew ya police hassle hota hai kya area mein?"),
        (9, "Generally fine if not creating noise. Respect locals."),
        (0, "Plan set — Marine Drive 10:30, phir cutting chai. Who's in?"),
        (1, "In. Late night gang assemble 🌙"),
    ],
    # 3 — Weekend plan
    [
        (0, "Weekend plan kya hai sabka? Main abhi bhi clueless."),
        (1, "Saturday trek, Sunday lazy + laundry. Classic."),
        (2, "Friend ne Goa bol diya — budget kitna realistic for 2 days?"),
        (3, "₹5-8k per person if bus + hostel. Flight alag story."),
        (4, "Movie ya web series binge — theatre worth it?"),
        (5, "Theatre for big releases. OTT for comfort."),
        (6, "Day trip near city — Alibaug / Lonavala type?"),
        (7, "Ferry + beach = solid without burning leave."),
        (8, "House party vs going out — team kya?"),
        (9, "House party. Playlist + snacks split."),
        (0, "Brunch overrated hai ya worth it once a month?"),
        (1, "Worth it for catch-up. Photo tax included 😂"),
        (2, "Gym skip karke weekend full rest — guilty feel hota hai?"),
        (3, "Rest bhi recovery hai. Monday se phir."),
        (4, "Random: best Sunday market for cheap shopping?"),
        (5, "Local flea markets — bargain skills mandatory."),
        (6, "Family obligation vs friends plan — kaise balance?"),
        (7, "Half day family, half day friends. Negotiate 😅"),
        (8, "Main toh ghar pe gaming + biryani. Zero regrets."),
        (9, "Solid plans everyone — Monday update dena gossip ke liye!"),
        (0, "Done. Enjoy weekend all 🙌"),
    ],
    # 4 — Street food
    [
        (0, "Street food recommendations chahiye — veg + non-veg dono."),
        (1, "Vada pav near station — Mumbai religion."),
        (2, "Paneer tikka roll — underrated street gem."),
        (3, "Hygiene kaise judge karte ho stall pe? Genuine question."),
        (4, "Crowd + turnover + gloves/tongs. Busy stall usually fresher."),
        (5, "Momos steamed ya fried? Team?"),
        (6, "Steamed + red chutney. Fight me."),
        (7, "Best chaat — bhel ya pani puri?"),
        (8, "Pani puri live counter — entertainment + taste."),
        (9, "Budget ₹200 mein kya khana fill karega?"),
        (0, "Pav bhaji plate + soda. Done."),
        (1, "Late night street food safe hai?"),
        (2, "Busy areas OK. Odd empty stall at 3 am — skip."),
        (3, "Spice level 'medium' bolna — still fire milta hai 😭"),
        (4, "Bolta hai 'thoda kam mirchi' — vendor smiles and ignores."),
        (5, "Sweet ending — kulfi ya gola?"),
        (6, "Kulfi falooda if feeling fancy on street."),
        (7, "Which city has best street food overall? Fight in chat."),
        (8, "Delhi vs Mumbai vs Kolkata — all have cases."),
        (9, "I'm ordering pani puri. 6 plates. No regrets."),
        (0, "Legend. Report back taste review 🙏"),
    ],
    # 5 — Bakwas lunch
    [
        (0, "Aaj ka lunch itna bakwas tha ki ab mood off hai 😤"),
        (1, "Same. Office canteen ne betray kar diya."),
        (2, "Kya mila? Dal pani jaisa ya dry roti?"),
        (3, "Soggy rice + mystery sabzi. Color suspicious."),
        (4, "Tiffin leak + taste fail — double trauma."),
        (5, "Genuine question: skip lunch or force eat bad food?"),
        (6, "Skip + 4 pm maggi. Survival mode."),
        (7, "Cafeteria 'special' pe trust mat karo — lesson learned."),
        (8, "WFH lunch = last night's leftover — better than canteen?"),
        (9, "Always. Canteen is roulette."),
        (0, "HR ne healthy salad push kiya — tastes like sadness."),
        (1, "Salad mein dressing bhi cheap. Double bakwas."),
        (2, "Best revenge — ghar pe achha dinner plan karo."),
        (3, "Swiggy order kiya compensatory biryani. No guilt."),
        (4, "Meal prep Sunday karta hun phir bhi Wednesday sad ho jata hai."),
        (5, "Sharing tiffin with colleague — risk ya bonding?"),
        (6, "Bonding until they take your last paratha."),
        (7, "School lunch nostalgia > adult lunch reality."),
        (8, "Adult lunch = meetings during chew. Rude."),
        (9, "Kal se tiffin ghar se. Declaration in chat for accountability."),
        (0, "Support group ban gaya ye bubble 😂 same guys tomorrow?"),
        (1, "Haan. Lunch rant daily thread chalega."),
    ],
]


class Command(BaseCommand):
    help = "Create 5 demo bubbles with 10 users each and Hindi/English sample chat."

    def add_arguments(self, parser):
        parser.add_argument(
            "--lat",
            type=float,
            default=DEFAULT_LAT,
            help=f"Bubble center latitude (default {DEFAULT_LAT})",
        )
        parser.add_argument(
            "--lng",
            type=float,
            default=DEFAULT_LNG,
            help=f"Bubble center longitude (default {DEFAULT_LNG})",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete previously seeded demo bubbles (title prefix match) before seeding.",
        )
        parser.add_argument(
            "--offset-km",
            type=float,
            default=0.3,
            help="Spread bubbles apart by ~km so they don't stack (default 0.3).",
        )

    def handle(self, *args, **options):
        lat = options["lat"]
        lng = options["lng"]
        offset_km = options["offset_km"]

        if options["clear"]:
            deleted = self._clear_demo_bubbles()
            self.stdout.write(self.style.WARNING(f"Cleared {deleted} existing demo bubble(s)."))

        radius = int(getattr(settings, "BUBBLLE_DEFAULT_RADIUS_M", 5000))
        expires_seconds = int(getattr(settings, "BUBBLLE_DEFAULT_EXPIRES_SECONDS", 23 * 60))
        expires_at = timezone.now() + timedelta(seconds=expires_seconds)

        created_bubbles = []
        total_messages = 0

        for i, title in enumerate(BUBBLE_TITLES):
            # Slight offset so 5 bubbles appear as separate nearby rooms
            dlat = (i - 2) * (offset_km / 111.0)
            dlng = (i % 2) * (offset_km / (111.0 * max(0.5, abs(lat) / 90)))

            bubble = Bubble.objects.create(
                title=title,
                latitude=lat + dlat,
                longitude=lng + dlng,
                radius=radius,
                expires_at=expires_at,
                active=True,
            )
            users = USER_POOLS[i]
            script = CONVERSATIONS[i]
            msg_count = self._seed_messages(bubble, users, script)
            total_messages += msg_count
            created_bubbles.append((bubble, users, msg_count))

            self.stdout.write(
                self.style.SUCCESS(
                    f"  [{i + 1}/5] {title}\n"
                    f"         id={bubble.id}\n"
                    f"         users={len(users)}, messages={msg_count}\n"
                    f"         lat={bubble.latitude:.4f}, lng={bubble.longitude:.4f}"
                )
            )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Demo seed complete."))
        self.stdout.write(f"  Bubbles: {len(created_bubbles)}")
        self.stdout.write(f"  Messages: {total_messages}")
        self.stdout.write(f"  Users per bubble: 10")
        self.stdout.write("")
        self.stdout.write("Open the app (use same lat/lng as seed):")
        self.stdout.write(f"  http://localhost:8000/?lat={lat}&lng={lng}")
        self.stdout.write("  Or set manual location in UI to:")
        self.stdout.write(f"  Latitude {lat}, Longitude {lng}")
        self.stdout.write("")
        self.stdout.write("Direct bubble links:")
        for bubble, _, _ in created_bubbles:
            self.stdout.write(f"  http://localhost:8000/bubble/{bubble.id}/")

    def _clear_demo_bubbles(self) -> int:
        all_titles = list(BUBBLE_TITLES) + LEGACY_DEMO_TITLES
        qs = Bubble.objects.filter(title__in=all_titles)
        count = qs.count()
        qs.delete()
        return count

    def _seed_messages(self, bubble: Bubble, users: list[str], script: list[tuple[int, str]]) -> int:
        """Insert messages with staggered timestamps; occasional reply_to."""
        now = timezone.now()
        reply_targets: list[Message] = []
        count = 0

        for idx, (speaker_idx, text) in enumerate(script):
            author = users[speaker_idx % len(users)]
            created_at = now - timedelta(minutes=(len(script) - idx) * random.randint(2, 5))

            reply_to = None
            if reply_targets and random.random() < 0.25:
                reply_to = random.choice(reply_targets[-4:])

            msg = Message.objects.create(
                bubble=bubble,
                anonymous_name=author,
                message=text,
                reply_to=reply_to,
            )
            Message.objects.filter(pk=msg.pk).update(created_at=created_at)
            reply_targets.append(msg)
            count += 1

        return count
