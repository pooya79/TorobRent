# TorobRent

TorobRent helps people discover rental homes and lets platform staff control which rental
information is published.

## People

**Renter**:
A person searching for a home to rent. A renter does not need an account to search or inspect
published rental information.
_Avoid_: Customer, searcher

**Submitter**:
An authenticated person who proposes rental information for publication on TorobRent.
_Avoid_: Provider, advertiser

**Owner**:
A Submitter who asserts that they own the Property represented by a Submission.
_Avoid_: Landlord

**Agent**:
A Submitter who asserts that they are authorized to advertise a Property on an owner's behalf.
_Avoid_: Broker, realtor

**Operator**:
A TorobRent staff member who reviews submitted rental information and controls its publication.
_Avoid_: Admin, moderator

## Rental catalog

**Property**:
A real-world home offered for rent whose normalized facts can be presented independently of any
one advertisement.
_Avoid_: Listing, advertisement

**Listing**:
One source's advertisement of a Property, including source-specific rental terms and a route to
continue with that source. Several Listings can refer to the same Property.
_Avoid_: Property, search result

**Active Listing**:
A published Listing whose stated availability has not expired and which has not been marked
unavailable. Only Active Listings make a Property eligible for search.
_Avoid_: Published listing

**Source**:
The website or direct TorobRent channel from which a Listing originates.
_Avoid_: Provider

**Submission**:
A Submitter's proposal for rental information to become a TorobRent Listing after operator
review.
_Avoid_: Listing, property

**Availability Confirmation**:
A Submitter's assertion that an unchanged Listing remains available, extending its publication
without proposing new rental information.
_Avoid_: Resubmission, reminder

**Rental Terms**:
The deposit and monthly-rent amounts advertised together by one Listing. The two amounts remain a
pair when filtering, sorting, and comparing Listings.
_Avoid_: Price, property price

**Feature State**:
An explicit assertion that a Property feature is present or absent, or an acknowledgement that the
feature is unknown. Missing source information is not treated as absence.
_Avoid_: Boolean feature
