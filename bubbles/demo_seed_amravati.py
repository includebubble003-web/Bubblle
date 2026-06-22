"""
Amravati-local demo seed content — fictional personas, realistic local references.

Used by: python manage.py seed_amravati_content
All rows tagged system_seed_content=True (removable).
"""

from __future__ import annotations

DEFAULT_LAT = 20.96
DEFAULT_LNG = 77.768

# Extra chat lines appended to existing communities (author, text).
AMRAVATI_COMMUNITY_MESSAGES: list[dict] = [
    {
        "bubble_title": "Software Engineers",
        "messages": [
            (
                "WFHDev",
                "Hi everyone. Main WFH SDE hoon aur Arjun Nagar side rehta hoon. "
                "Like-minded tech people se milna chahta hoon.",
            ),
            (
                "RajapethCoder",
                "Main Rajapeth se hoon. Weekend mein random scrolling karne se better hai "
                "milke ideas discuss karein.",
            ),
            ("CursorUser", "Koi Cursor AI use kar raha hai daily?"),
            ("StackCurious", "Remote jobs ke liye abhi kaunsa stack sabse demand mein hai?"),
        ],
    },
    {
        "bubble_title": "Book Readers Club",
        "messages": [
            (
                "ShegaonReader",
                "Koi book exchange karna chahta hai? Mere paas kaafi novels hain. "
                "Main Shegaon Naka side rehta hoon.",
            ),
            ("HabitSkeptic", "Atomic Habits overhyped hai ya genuinely useful?"),
            ("HindiFictionFan", "Hindi fiction recommendations?"),
        ],
    },
    {
        "bubble_title": "Fitness Enthusiasts",
        "messages": [
            (
                "LegDayWarrior",
                "Aaj leg day skip karne ka mann kar raha tha, phir bhi gaya.",
            ),
            ("ProteinCurious", "Protein powder kaunsa use kar rahe ho sab?"),
            ("MorningVsEvening", "Morning workout ya evening workout?"),
        ],
    },
]

# (author, answer text)
Answer = tuple[str, str]

AMRAVATI_QUESTIONS: list[dict] = [
    {
        "title": "Best Coffee Shop for WFH and Good Coffee?",
        "description": "Need WiFi, plugs, and actually good coffee in Amravati.",
        "author": "RemoteSip",
        "bubble_title": "Coffee Lovers",
        "answers": [
            (
                "DavidoffFan",
                "Yaar mujhe toh Hello ki Davidoff wali cold coffee pasand hai. Apart from that, "
                "genuine coffee milna thoda tough hai town mein. Agar kisi ko achi jagah pata ho toh batao.",
            ),
            (
                "DessertLover",
                "Dessert & More try karo. Unki specialty coffee kaafi achi hai. Real coffee taste aata hai.",
            ),
            (
                "RedBullCoffee",
                "Sirf mujhe lagta hai ya Red Bull + Coffee combo se focus next level ho jata hai?",
            ),
        ],
    },
    {
        "title": "Any Affordable Gym (No Backchodi) Nearby?",
        "description": "Straightforward gym, no unnecessary drama. Budget-friendly preferred.",
        "author": "GymHunter",
        "bubble_title": "Fitness Enthusiasts",
        "answers": [
            (
                "MountRegular",
                "Mount Gym sahi hai. Vibe bhi achi hai aur faltu bakar kam hai. "
                "Agar Shegaon Naka side rehte ho toh try karo.",
            ),
            (
                "OwaisFan",
                "Owais Gym bhi theek hai. Kometa mujhe personally utna pasand nahi aaya.",
            ),
            ("SpartaSupporter", "Sparta ka setup bhi kaafi acha hai."),
            (
                "GymHopper",
                "Sparta sahi hai, lekin main har 6-8 mahine gym change karta rehta hoon "
                "bore hone se bachne ke liye.",
            ),
        ],
    },
    {
        "title": "Best Make Out Place In Amravati? (Please don't spam)",
        "description": "Genuine local suggestions only — no spam please.",
        "author": "CuriousLocal",
        "bubble_title": None,
        "answers": [
            (
                "HighwayObserver",
                "I have seen many people making out in cars on highway — safe hai. Baki raat mein "
                "Lords wale highway pe kisi bhi dhabe ke piche you can make out. Koi aata nahi.",
            ),
            (
                "GadgeNagarLocal",
                "Gadge Nagar mein pool ke niche koi lafda nahi.",
            ),
            (
                "BusyLandTip",
                "Busy land mein park karo — shuru ho jao.",
            ),
            (
                "PoteSide",
                "Pote ki taraf police ka mahol bahut hai, bandi dar jati. Gadge Nagar pool ke niche "
                "maine bhi kiya hai, but TBH hotel hi le jao.",
            ),
            (
                "EdifyRoad",
                "Pote–Paratwada road, Edify ke aage pura road khali rehta hai.",
            ),
            (
                "TheatreVeteran",
                "We used to make out a lot in theatre but abhi waha bhi camera laga diye. "
                "Aswad hotel mein cabin hote hain, koi nahi aata.",
            ),
        ],
    },
    {
        "title": "Affordable Zumba Classes Only for Women?",
        "description": "Looking for women-only Zumba in Amravati. Budget-friendly.",
        "author": "ZumbaSeeker",
        "bubble_title": "Fitness Enthusiasts",
        "answers": [
            (
                "MountGymInfo",
                "Mount Gym mein suna hai classes hoti hain. Mujhe bhi details chahiye agar kisi ko pata ho toh batao.",
            ),
        ],
    },
    {
        "title": "Amravati Mein Achhi Coffee Kahan Milti Hai?",
        "description": "Hot coffee recommendations around town.",
        "author": "CaffeineAM",
        "bubble_title": "Coffee Lovers",
        "answers": [
            (
                "CappuccinoFan",
                "Dessert & More ki hot cappuccino kaafi achi hai.",
            ),
            (
                "HelloRegular",
                "Sach bolu toh Hello ki coffee bhi kaafi consistent lagti hai.",
            ),
        ],
    },
    {
        "title": "MMA ya Strength Training Kahan Hoti Hai?",
        "description": "Looking for MMA or serious strength training in Amravati.",
        "author": "FightFit",
        "bubble_title": "Fitness Enthusiasts",
        "answers": [
            (
                "ZillaSide",
                "Zilla side ek training center hai. Bas naam yaad nahi aa raha. Koi gaya ho toh review do.",
            ),
        ],
    },
    {
        "title": "Poha Ke Alawa Achha Nashta Kahan Milta Hai?",
        "description": "Subah ka nashta options beyond poha in Amravati.",
        "author": "BreakfastHunter",
        "bubble_title": "Local Foodies",
        "answers": [
            ("KachoriFan", "Subah Manish ki Kachori mast hoti hai."),
            ("MatthaLover", "Roshni ka Mattha try karo."),
            ("BondaFan", "Rajkamal ka Aloo Bonda underrated hai."),
            (
                "MedicalLane",
                "Pawan Medical ke paas bhi aajkal kaafi achha nashta milta hai.",
            ),
        ],
    },
    {
        "title": "MPSC Student - Part Time Job Kahan Mil Sakti Hai?",
        "description": "Preparing for MPSC, need part-time work that doesn't kill study time.",
        "author": "MPSCPrep",
        "bubble_title": "Job Seekers Network",
        "answers": [
            ("DrinkAddaSpotter", "Drink Adda pe hiring ka board dekha tha recently."),
            ("MallStaff", "Tapadia Mall mein staff ki requirement thi."),
            ("McDShift", "McDonald's mein bhi part-time shifts mil jati hain."),
        ],
    },
    {
        "title": "Best Biryani in Amravati?",
        "description": "Mutton or chicken — best spots in town?",
        "author": "BiryaniJudge",
        "bubble_title": "Local Foodies",
        "answers": [
            ("AlHabibFan", "Al Habib meri personal favourite hai."),
            ("RizwanFan", "Rizwan ki mutton biryani kaafi log recommend karte hain."),
            ("AlHayatFan", "Al Hayat bhi achi hai."),
        ],
    },
    {
        "title": "Best Box Cricket Ground?",
        "description": "Turf/box cricket grounds in Amravati — which is best?",
        "author": "BoxCricket",
        "bubble_title": "Cricket Fans",
        "answers": [
            ("ChitraGround", "Chitra wala bhi sahi hai."),
            (
                "UniRoad",
                "University Road ke dono grounds kaafi ache hain.",
            ),
            ("HVPMFan", "HVPM wala size ke hisaab se best lagta hai."),
        ],
    },
    {
        "title": "Achha Dosa Kahan Milta Hai?",
        "description": "Crispy dosa spots in Amravati?",
        "author": "DosaHunter",
        "bubble_title": "Local Foodies",
        "answers": [
            (
                "WelcomePoint",
                "Blue Castle ke paas Welcome Point try karo.",
            ),
        ],
    },
    {
        "title": "Good Pet Care Doctor/Hospital?",
        "description": "Vet or pet hospital recommendations in Amravati.",
        "author": "PetParent",
        "bubble_title": None,
        "answers": [
            (
                "NavsariClinic",
                "Navsari side ek achha pet clinic hai. Exact naam yaad nahi.",
            ),
            (
                "AlsoLooking",
                "Mujhe bhi recommendation chahiye. City mein options kaafi kam hain.",
            ),
        ],
    },
    {
        "title": "Best Masala Pan Nearby?",
        "description": "Masala pan spots in Amravati.",
        "author": "PanLover",
        "bubble_title": "Local Foodies",
        "answers": [
            (
                "UPSeller",
                "Rajapeth Suzuki showroom ke paas UP wale bhaiya ka pan mast hai.",
            ),
            (
                "RajputZayka",
                "Rajput Zayka ke paas bhi achha pan milta hai.",
            ),
        ],
    },
    {
        "title": "Good Men's Salon Under ₹150?",
        "description": "Affordable men's haircut in Amravati — under 150 rupees.",
        "author": "BudgetGroom",
        "bubble_title": None,
        "answers": [
            (
                "GudduFan",
                "Guddu Bhaiya, Gadge Nagar Police Station ke aage. Kaafi log recommend karte hain.",
            ),
            (
                "VilasNagarRegular",
                "Vilas Nagar side ek barber hai, main 10 saal se wahi ja raha hoon.",
            ),
            (
                "UPSalonFan",
                "UP Salon, Shegaon Naka bhi kaafi achha hai.",
            ),
        ],
    },
]

AMRAVATI_QUESTION_TITLES: list[str] = [q["title"] for q in AMRAVATI_QUESTIONS]

AMRAVATI_MESSAGE_TEXTS: frozenset[str] = frozenset(
    text for group in AMRAVATI_COMMUNITY_MESSAGES for _, text in group["messages"]
)
